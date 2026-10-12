import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { startApiServer } from '../src/api-server.mjs';

// 配置导出/导入：每个用例独占一个 CONTEST_PUBLISHER_HOME，导出文件就落在这个临时目录里。
async function withServer(run) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cp-cfg-'));
  const runsRoot = path.join(home, 'runs');
  const previous = process.env.CONTEST_PUBLISHER_HOME;
  process.env.CONTEST_PUBLISHER_HOME = home;
  const api = await startApiServer({ host: '127.0.0.1', port: 0, runsRoot });
  const base = `http://127.0.0.1:${api.port}`;
  const get = async (url) => (await fetch(`${base}${url}`)).json();
  const post = async (url, body) => {
    const response = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try { await run({ get, post, home, runsRoot }); }
  finally {
    await new Promise(resolve => api.server.close(resolve));
    if (previous === undefined) delete process.env.CONTEST_PUBLISHER_HOME; else process.env.CONTEST_PUBLISHER_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}

const TOKEN = 'gitcode-token-for-test-0001';

test('export writes a config file without the GitCode token by default', async () => {
  await withServer(async ({ get, post, runsRoot }) => {
    await post('/api/settings', { cfgRepoName: 'demo-project', cfgGitToken: TOKEN, cfgKeepPaths: 'reports', cfgProblemNumber: '5' });
    const result = await get('/api/config/export');
    assert.equal(result.ok, true);
    assert.equal(result.includesToken, false);
    assert.ok(!result.keys.includes('cfgGitToken'), `keys 里不该有 token: ${result.keys.join(',')}`);
    assert.match(path.basename(result.path), /^contest-publisher-config-\d{8}-\d{4}\.json$/);
    const payload = JSON.parse(await readFile(result.path, 'utf8'));
    assert.equal(payload._app, 'contest-publisher');
    assert.equal(payload._schema, 1);
    assert.equal(payload._includesToken, false);
    assert.equal(payload.settings.cfgRepoName, 'demo-project');
    assert.equal(payload.settings.cfgKeepPaths, 'reports');
    assert.equal(payload.settings.runsRoot, runsRoot);
    assert.ok(!('cfgGitToken' in payload.settings), '默认导出不该带 token');
    assert.ok(!JSON.stringify(payload).includes(TOKEN), '导出文件里不该出现 token 明文');
  });
});

test('export includes the token only when explicitly asked, and the file stays 0600', async () => {
  await withServer(async ({ get, post }) => {
    await post('/api/settings', { cfgRepoName: 'demo-project', cfgGitToken: TOKEN });
    const result = await get('/api/config/export?includeToken=1');
    assert.equal(result.includesToken, true);
    assert.ok(result.keys.includes('cfgGitToken'));
    const payload = JSON.parse(await readFile(result.path, 'utf8'));
    assert.equal(payload.settings.cfgGitToken, TOKEN);
    assert.equal(payload._includesToken, true);
    const mode = (await stat(result.path)).mode & 0o777;
    assert.equal(mode, 0o600, `含凭证的导出文件必须是 0600，实际 ${mode.toString(8)}`);
  });
});

test('import applies whitelisted scalars, switches the runs root and reports what it skipped', async () => {
  await withServer(async ({ get, post, home, runsRoot }) => {
    const nextRoot = path.join(home, 'runs-imported');
    const result = await post('/api/config/import', {
      settings: {
        cfgRepoName: 'imported-project',
        cfgProblemNumber: '9',
        cfgExecuteSubmit: true,
        runsRoot: nextRoot,
        cfgSomethingUnknown: 'x',
        cfgKeepPaths: { nested: true },
      },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.applied.sort(), ['cfgExecuteSubmit', 'cfgProblemNumber', 'cfgRepoName', 'runsRoot']);
    assert.deepEqual(result.body.skipped.sort(), ['cfgKeepPaths', 'cfgSomethingUnknown']);
    assert.equal(result.body.runsRoot, nextRoot);

    const settings = await get('/api/settings');
    assert.equal(settings.cfgRepoName, 'imported-project');
    assert.equal(settings.cfgProblemNumber, '9');
    assert.equal(settings.cfgExecuteSubmit, true);
    assert.equal(settings.runsRoot, nextRoot);
    assert.notEqual(settings.runsRoot, runsRoot);
    // 非标量值不能被写进设置文件
    const onDisk = JSON.parse(await readFile(path.join(home, 'settings.json'), 'utf8'));
    assert.ok(!('cfgKeepPaths' in onDisk) || typeof onDisk.cfgKeepPaths === 'string');
    assert.ok(!('cfgSomethingUnknown' in onDisk));
  });
});

test('import rejects files that are not ours', async () => {
  await withServer(async ({ post }) => {
    const missing = await post('/api/config/import', { settings: null });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /settings/);
    const wrongShape = await post('/api/config/import', { settings: [1, 2, 3] });
    assert.equal(wrongShape.status, 400);
    const noKnownKeys = await post('/api/config/import', { settings: { whatever: 'x' } });
    assert.equal(noKnownKeys.status, 400);
    assert.match(noKnownKeys.body.error, /没有可导入的配置项/);
  });
});

test('an exported file round-trips back into the same settings', async () => {
  await withServer(async ({ get, post, home }) => {
    await post('/api/settings', { cfgRepoName: 'round-trip', cfgAuthorName: 'Tester', cfgGitToken: TOKEN, cfgKeepPaths: 'reports\ndashboard' });
    const exported = await get('/api/config/export?includeToken=1');
    const payload = JSON.parse(await readFile(exported.path, 'utf8'));

    // 清空后再导入，配置应当完全回来
    await post('/api/config/import', { settings: { cfgRepoName: '', cfgAuthorName: '', cfgGitToken: '', cfgKeepPaths: '' } });
    const cleared = await get('/api/settings');
    assert.equal(cleared.cfgRepoName, '');

    const imported = await post('/api/config/import', { settings: payload.settings });
    assert.equal(imported.status, 200);
    const restored = await get('/api/settings');
    assert.equal(restored.cfgRepoName, 'round-trip');
    assert.equal(restored.cfgAuthorName, 'Tester');
    assert.equal(restored.cfgGitToken, TOKEN);
    assert.equal(restored.cfgKeepPaths, 'reports\ndashboard');
    const onDisk = await readFile(path.join(home, 'settings.json'), 'utf8');
    assert.ok(onDisk.includes('round-trip'));
  });
});
