import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import vm from 'node:vm';
import { APP_HTML } from '../src/ui/app.mjs';
import { startUiServer } from '../src/ui-server.mjs';

test('serves the workbench UI and health endpoint', async () => {
  const runsRoot = await mkdtemp(path.join(os.tmpdir(), 'contest-ui-'));
  const app = await startUiServer({ port: 0, runsRoot, open: false });
  try {
    const health = await fetch(`${app.url}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, app: 'contest-publisher', platform: process.platform, packaged: false });
    const page = await fetch(`${app.url}/`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Contest Publisher/);
    assert.match(html, /获取源仓库/);
    assert.match(html, /执行提交/);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    await rm(runsRoot, { recursive: true, force: true });
  }
});

// 页面内嵌脚本一旦有语法错误，整页按钮全部失效（真实事故：模板里把 \n 写成了真实换行）。
// 这里只编译不执行，把"页面能不能用"变成自动门禁。
test('the workbench page ships a parseable inline script', () => {
  const start = APP_HTML.indexOf('<script>') + '<script>'.length;
  const end = APP_HTML.lastIndexOf('</script>');
  const script = APP_HTML.slice(start, end);
  assert.ok(script.length > 1000, 'inline script present');
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'workbench-inline.js' }));
});

// 运行列表折叠：数量多了要能折起来，且状态要记忆（localStorage）。
test('the runs list ships a collapse toggle', () => {
  assert.match(APP_HTML, /id="runsToggleBtn"/);
  assert.match(APP_HTML, /id="runsCount"/);
  assert.match(APP_HTML, /applyRunsCollapsed/);
  assert.match(APP_HTML, /cp_runs_collapsed/);
});
