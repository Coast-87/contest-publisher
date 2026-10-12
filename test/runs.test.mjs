import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { startApiServer } from '../src/api-server.mjs';
import { runGit } from '../src/process.mjs';
import { exists } from '../src/store.mjs';

async function makeRun(root, id) {
  const dir = path.join(root, id);
  await mkdir(path.join(dir, 'evidence'), { recursive: true });
  await writeFile(path.join(dir, 'source.json'), JSON.stringify({ schemaVersion: 1, commit: 'deadbeef' }));
  return dir;
}

// A run whose source checkout is a real git repository, so audit/prepare/verify can run on it.
async function makeSourceRun(root, id, { license } = {}) {
  const dir = path.join(root, id);
  const source = path.join(dir, 'source');
  await mkdir(path.join(source, 'src'), { recursive: true });
  await writeFile(path.join(source, 'src', 'main.js'), 'export const answer = 42;\n');
  if (license) await writeFile(path.join(source, 'LICENSE'), license);
  runGit(['init', '-q', source]);
  runGit(['-C', source, 'add', '-A']);
  runGit(['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  return dir;
}

async function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

// Each case gets an isolated workspace: a temp runs root plus a temp settings
// home, so a switched runs root can never touch the operator's real config.
async function withServer(run) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'contest-runs-'));
  process.env.CONTEST_PUBLISHER_HOME = path.join(tmp, 'home');
  const runsRoot = path.join(tmp, 'runs');
  await mkdir(runsRoot, { recursive: true });
  const api = await startApiServer({ port: 0, runsRoot });
  const url = `http://127.0.0.1:${api.port}`;
  try { await run({ url, runsRoot, tmp }); }
  finally {
    await new Promise(resolve => api.server.close(resolve));
    await rm(tmp, { recursive: true, force: true });
  }
}

test('accepts both a percent-encoded absolute run directory and a bare run id', async () => {
  await withServer(async ({ url, runsRoot }) => {
    const id = '20261010T131500Z-abc123';
    const dir = await makeRun(runsRoot, id);
    const absolute = await fetch(`${url}/api/runs/${encodeURIComponent(dir)}`);
    assert.equal(absolute.status, 200);
    assert.equal((await absolute.json()).runId, id);
    const bare = await fetch(`${url}/api/runs/${id}`);
    assert.equal(bare.status, 200);
    assert.equal((await bare.json()).runId, id);
  });
});

test('rejects run ids that are malformed or escape the runs root', async () => {
  await withServer(async ({ url, runsRoot }) => {
    await makeRun(runsRoot, '20261010T131500Z-abc123');
    const bad = ['%2E%2E%2F..%2Fetc', 'not a run id', encodeURIComponent('/etc'), encodeURIComponent(path.join(runsRoot, '..', 'outside'))];
    for (const id of bad) {
      const res = await fetch(`${url}/api/runs/${id}`);
      assert.equal(res.status, 400, `expected 400 for ${id}`);
      assert.match((await res.json()).error, /Invalid run id/);
    }
  });
});

test('deletes a run and refuses directories that are not runs', async () => {
  await withServer(async ({ url, runsRoot }) => {
    const id = '20261010T131500Z-del001';
    const dir = await makeRun(runsRoot, id);
    const stray = path.join(runsRoot, 'not-a-run');
    await mkdir(stray, { recursive: true });

    const refused = await fetch(`${url}/api/runs/not-a-run`, { method: 'DELETE' });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /拒绝删除/);
    assert.equal(await exists(stray), true);

    const deleted = await fetch(`${url}/api/runs/${id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { deleted: true, runId: id, runDir: dir });
    assert.equal(await exists(dir), false);
    const runs = await (await fetch(`${url}/api/runs`)).json();
    assert.equal(runs.some(item => item.runId === id), false);
  });
});

test('requires a forced delete while an initialized work copy has never been pushed', async () => {
  await withServer(async ({ url, runsRoot }) => {
    const id = '20261010T131500Z-force1';
    const dir = await makeRun(runsRoot, id);
    await mkdir(path.join(dir, 'work', '.git'), { recursive: true });

    const refused = await fetch(`${url}/api/runs/${id}`, { method: 'DELETE' });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /强制删除/);
    assert.equal(await exists(dir), true);

    const forced = await fetch(`${url}/api/runs/${id}?force=1`, { method: 'DELETE' });
    assert.equal(forced.status, 200);
    assert.equal(await exists(dir), false);
  });
});

test('switches the runs root, persists it, and lists runs from the new root', async () => {
  await withServer(async ({ url, runsRoot, tmp }) => {
    const next = path.join(tmp, 'next-runs');
    assert.equal((await (await fetch(`${url}/api/runs-root`)).json()).runsRoot, runsRoot);

    const saved = await post(`${url}/api/settings`, { runsRoot: next });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).runsRoot, next);
    assert.equal((await (await fetch(`${url}/api/runs-root`)).json()).runsRoot, next);
    assert.equal((await (await fetch(`${url}/api/settings`)).json()).runsRoot, next);
    assert.equal(await exists(path.join(tmp, 'home', 'settings.json')), true);

    const id = '20261010T131500Z-moved1';
    await makeRun(next, id);
    const runs = await (await fetch(`${url}/api/runs`)).json();
    assert.deepEqual(runs.map(item => item.runId), [id]);
  });
});

test('a rejected clone URL never moves the runs root', async () => {
  await withServer(async ({ url, runsRoot, tmp }) => {
    const res = await post(`${url}/api/runs`, { sourceUrl: 'http://gitcode.com/org/project.git', runsRoot: path.join(tmp, 'evil-runs') });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /HTTPS/);
    assert.equal((await (await fetch(`${url}/api/runs-root`)).json()).runsRoot, runsRoot);
    assert.equal(await exists(path.join(tmp, 'evil-runs')), false);
  });
});

test('work-files feeds the editor picker classified paths', async () => {
  await withServer(async ({ url, runsRoot }) => {
    const id = '20261010T131500Z-files1';
    const dir = await makeRun(runsRoot, id);
    await mkdir(path.join(dir, 'work', 'src'), { recursive: true });
    await writeFile(path.join(dir, 'work', 'src', 'main.js'), 'export const answer = 42;\n');
    await writeFile(path.join(dir, 'work', 'CONTRIBUTIONS.md'), '# Contributions\n');

    const files = await (await fetch(`${url}/api/runs/${id}/work-files`)).json();
    assert.deepEqual(files, [
      { path: 'CONTRIBUTIONS.md', kind: 'docs' },
      { path: 'src/main.js', kind: 'code' },
    ]);
  });
});

test('auto-push records per-step progress the workbench can poll', async () => {
  await withServer(async ({ url, runsRoot }) => {
    const id = '20261010T131500Z-push01';
    await makeRun(runsRoot, id);

    // Before any push, the progress endpoint reports idle instead of 404.
    const idle = await (await fetch(`${url}/api/runs/${id}/auto-push-progress`)).json();
    assert.equal(idle.stage, 'idle');

    // Missing token fails fast at the create-repo gate; progress ends in error.
    const unconfigured = await post(`${url}/api/runs/${id}/auto-push`, { config: {} });
    assert.equal(unconfigured.status, 200);
    assert.equal((await unconfigured.json()).ok, false);
    const failed = await (await fetch(`${url}/api/runs/${id}/auto-push-progress`)).json();
    assert.equal(failed.stage, 'error');
    assert.match(failed.error, /GitCode Access Token/);

    // With a token present the pipeline starts at verify; a run without a prepared
    // work copy fails there, and that failure is visible as a finished step.
    const withToken = await post(`${url}/api/runs/${id}/auto-push`, { config: { gitToken: 'tok' } });
    assert.equal(withToken.status, 200);
    const body = await withToken.json();
    assert.equal(body.ok, false);
    assert.equal(body.stage, 'verify');
    const progress = await (await fetch(`${url}/api/runs/${id}/auto-push-progress`)).json();
    assert.equal(progress.stage, 'error');
    assert.equal(progress.steps.length, 1);
    assert.equal(progress.steps[0].name, 'verify');
    assert.equal(progress.steps[0].status, 'error');
    assert.match(progress.steps[0].detail, /Work directory|manifest|工作副本|验证/);
    assert.equal(progress.current, null);
    assert.ok(progress.finishedAt);
  });
});

test('local sources: list the drop folder and create a run from a code package', async () => {
  await withServer(async ({ url, runsRoot, tmp }) => {
    // 本地仓库目录：软件首次使用会自动建目录并留说明文件。
    const settings = await post(`${url}/api/settings`, { localSourcesDir: path.join(tmp, 'sources') });
    assert.equal(settings.status, 200);
    const listing = await (await fetch(`${url}/api/local-sources`)).json();
    assert.equal(listing.dir, path.join(tmp, 'sources'));
    assert.deepEqual(listing.entries, []);
    assert.equal(await exists(path.join(listing.dir, 'README.txt')), true, '首次使用留下说明文件');

    // 放入一个代码包（GitHub 下载的文件夹形式）后出现在下拉列表里。
    const project = path.join(listing.dir, 'Demo-Project-main');
    await mkdir(path.join(project, 'src'), { recursive: true });
    await writeFile(path.join(project, 'src', 'app.js'), 'export const ok = true;\n');
    await writeFile(path.join(project, 'README.md'), '# Demo\n');
    const after = await (await fetch(`${url}/api/local-sources`)).json();
    assert.deepEqual(after.entries.map(item => item.name), ['Demo-Project-main']);

    // 不存在的条目不会创建运行，也不会切换工作区。
    const missing = await post(`${url}/api/runs`, { localSource: 'nope', runsRoot: path.join(tmp, 'other-runs') });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /本地仓库里没有/);
    assert.equal(await exists(path.join(tmp, 'other-runs')), false);

    // 选中条目 → 只读快照运行，源记录标记为本地。
    const created = await post(`${url}/api/runs`, { localSource: 'Demo-Project-main' });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.source.sourceKind, 'local');
    assert.equal(body.source.localName, 'Demo-Project-main');
    assert.equal(await exists(path.join(runsRoot, body.runId, 'source', 'src', 'app.js')), true);
    const status = await (await fetch(`${url}/api/runs/${body.runId}`)).json();
    assert.equal(status.suggestedRepoName, 'Demo-Project', '仓库名跟随代码包名（去掉 -main）');
  });
});

test('problems endpoint lists competition problems so the target is visible before pushing', async () => {
  await withServer(async ({ url, runsRoot, tmp }) => {
    const id = '20261010T131500Z-prob01';
    await makeRun(runsRoot, id);
    // Stub skill: the endpoint needs scripts/list-problems.mjs and parses its #problem lines.
    const skillDir = path.join(tmp, 'skill');
    await mkdir(path.join(skillDir, 'scripts'), { recursive: true });
    await writeFile(path.join(skillDir, 'scripts', 'list-problems.mjs'),
      'console.log("#status=200");\n'
      + 'console.log("#problem 1 测试赛题甲 window=2026-09-17~2026-11-08 status=published");\n'
      + 'console.log("#problem 2 带 空格 的赛题名");\n');

    const missing = await fetch(`${url}/api/runs/${id}/problems`);
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /STS 凭证/);

    const res = await fetch(`${url}/api/runs/${id}/problems?creds=${encodeURIComponent('/tmp/fake-creds.json')}&skillDir=${encodeURIComponent(skillDir)}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.items, [
      { number: 1, name: '测试赛题甲', window: '2026-09-17~2026-11-08', status: 'published' },
      { number: 2, name: '带 空格 的赛题名', window: null, status: null },
    ]);
  });
});

test('run status suggests a target repo name derived from the source URL', async () => {
  await withServer(async ({ url, runsRoot }) => {
    const id = '20261010T131500Z-name01';
    const dir = await makeRun(runsRoot, id);
    await writeFile(path.join(dir, 'source.json'), JSON.stringify({ schemaVersion: 1, sourceUrl: 'https://gitcode.com/org/Gallery.git', commit: 'deadbeef' }));
    const status = await (await fetch(`${url}/api/runs/${id}`)).json();
    assert.equal(status.suggestedRepoName, 'Gallery');
  });
});

test('auto-run resolves license and attribution findings instead of dying at prepare', async () => {
  await withServer(async ({ url, runsRoot }) => {
    // One source without a license file, one whose LICENSE carries a maintainer address.
    const plain = '20261010T131500Z-auto01';
    const licensed = '20261010T131500Z-auto02';
    await makeSourceRun(runsRoot, plain);
    await makeSourceRun(runsRoot, licensed, { license: 'MIT License\n\nCopyright (c) 2024 Alice <alice@corp-mail.io>\n' });

    for (const id of [plain, licensed]) {
      const res = await post(`${url}/api/runs/${id}/auto-run`, { name: 'contest-project' });
      assert.equal(res.status, 200);
      const body = await res.json();
      const context = `${id}: ${JSON.stringify(body.log)}`;
      // A rejected decision (illegal decision for the category) is what used to strand prepare.
      assert.equal(body.log.some(line => line.name === 'review' && line.status === 'warn' && /not allowed|is required|not present/.test(line.detail ?? '')), false, context);
      assert.equal(body.log.find(line => line.name === 'prepare')?.status, 'done', context);
      assert.match(body.log.find(line => line.name === 'prepare')?.detail ?? '', /^工作副本已生成：[1-9]/, context);
      assert.equal(body.log.some(line => line.name === 'review' && /无需人工处理/.test(line.detail ?? '')), false, context);
      assert.equal(body.stage, 'verify', context);
      assert.equal(body.ok, false);
      assert.ok(body.verified, `no verify result: ${JSON.stringify(body)}`);
      assert.match(JSON.stringify(body.verified.findings), /no-original-code-delta/);

      // The workbench hides findings that already carry a decision.
      const status = await (await fetch(`${url}/api/runs/${id}`)).json();
      assert.deepEqual(status.reviewedFindings, id === plain ? ['license:missing'] : ['personal-data:LICENSE:1'], context);

      // Diff endpoint: what changed relative to the pinned source checkout.
      const diff = await (await fetch(`${url}/api/runs/${id}/diff?hunks=0`)).json();
      assert.equal(diff.summary.generated, 5, context);
      assert.equal(diff.summary.editedByAuthor, 0, context);
      assert.equal(diff.files.find(file => file.path === 'src/main.js').status, 'unchanged', context);
      assert.equal(diff.files.find(file => file.path === 'CONTRIBUTIONS.md').origin, 'generated', context);
      assert.equal(diff.files.every(file => file.diff === null), true, 'hunks=0 omits line diffs');
      const one = await (await fetch(`${url}/api/runs/${id}/diff?path=${encodeURIComponent('src/main.js')}&hunks=1`)).json();
      assert.equal(one.files.length, 1, context);
      assert.equal(one.summary.generated, 5, 'summary still covers the whole work copy');

      // Copy mode: the delta rule is waived (and recorded), so a straight re-publish can pass.
      assert.equal(status.mode, 'strict', 'strict is the default');
      const mode = await post(`${url}/api/runs/${id}/mode`, { mode: 'copy' });
      assert.equal(mode.status, 200);
      const modeBody = await mode.json();
      assert.equal(modeBody.mode, 'copy');
      assert.equal(modeBody.record.written, false, 'the record is mode-independent and already current');
      assert.equal(modeBody.record.reason, 'already current');
      const contributions = await readFile(path.join(runsRoot, id, 'work', 'CONTRIBUTIONS.md'), 'utf8');
      assert.equal((contributions.match(/此为大赛提交所建/g) ?? []).length, 4);
      assert.doesNotMatch(contributions, /TODO/);
      const verified = await post(`${url}/api/runs/${id}/verify`, {});
      const verifiedBody = await verified.json();
      assert.equal(verifiedBody.status, 'passed', `${context} ${JSON.stringify(verifiedBody.findings)}`);
      assert.equal(verifiedBody.mode, 'copy');
      assert.equal(verifiedBody.findings.some(item => item.category === 'no-original-code-delta' && item.disposition === 'waived'), true);
      const after = await (await fetch(`${url}/api/runs/${id}`)).json();
      assert.equal(after.stage, 'VERIFIED', context);
      assert.equal(after.mode, 'copy');
    }
  });
});

// 一键清除：与单条删除同一套护栏——未推送的工作副本默认跳过，force 才删。
test('clearing all runs keeps unfinished work copies unless forced', async () => {
  await withServer(async ({ url, runsRoot }) => {
    const plain = '20261010T131500Z-clear1';
    const risky = '20261010T131500Z-clear2';
    await makeRun(runsRoot, plain);
    const riskyDir = await makeRun(runsRoot, risky);
    await mkdir(path.join(riskyDir, 'work', '.git'), { recursive: true });

    const first = await post(`${url}/api/runs/clear`, {});
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.deepEqual(body.deleted, [plain]);
    assert.deepEqual(body.skipped.map(item => item.runId), [risky]);
    assert.equal(await exists(riskyDir), true, '未推送的工作副本被保留');

    const forced = await (await post(`${url}/api/runs/clear`, { force: true })).json();
    assert.deepEqual(forced.deleted, [risky]);
    assert.deepEqual(forced.skipped, []);
    assert.equal(await exists(riskyDir), false);
  });
});
