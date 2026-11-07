import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runWorkbenchSession } from '../src/launcher.mjs';

// 窗口进程秒退（Edge 把 URL 交接给残留实例）曾是「自动打开 web 端」的直接原因。
// 这里用假 launch/killStale 把三条路径钉死：清理后重试成功、重试仍秒退才退默认浏览器、非 Windows 原样。

function fakeChild(behavior) {
  const child = new EventEmitter();
  child.pid = 12345;
  child.exitCode = null; // 与真实 spawn 一致：运行中为 null，waitForExit 靠它区分
  if (behavior === 'fast-exit') setTimeout(() => { child.exitCode = 0; child.emit('exit', 0); }, 20);
  // 'alive' 不发 exit —— 测试收尾时手动 settle，避免文件级超时。
  return child;
}

const WIN = { platform: 'win32' };

test('秒退 → 清残留 → 重试存活：不再打开默认浏览器', async () => {
  const opens = [];
  const logs = [];
  let launchCount = 0;
  let killCount = 0;
  const children = [];
  const sessionPromise = runWorkbenchSession('http://127.0.0.1:9/', {
    ...WIN,
    profileDir: 'C:\\x\\browser-profile',
    minLifetimeMs: 300,
    log: m => logs.push(m),
    launch: () => { launchCount += 1; const c = fakeChild(launchCount === 1 ? 'fast-exit' : 'alive'); children.push(c); return { child: c, browser: 'edge.exe' }; },
    killStale: () => { killCount += 1; return 2; },
    open: () => { opens.push('default-browser'); },
  });
  await new Promise(r => setTimeout(r, 400));
  // 第 1 次秒退（20ms）→ 清理 + 重试 → 第 2 个 child 还活着 → 会话未结束、未退默认浏览器。
  assert.equal(launchCount, 2, 'should retry launch once after fast exit');
  assert.equal(killCount, 2, 'killStale runs pre-spawn and after fast exit');
  assert.equal(opens.length, 0, 'must not open default browser while retry window is alive');
  assert.ok(logs.some(l => l.includes('重试启动')), 'log records the retry');
  children.forEach(c => { c.exitCode = 0; c.emit('exit', 0); }); // 收尾：让挂起的会话结束
  const session = await sessionPromise;
  assert.equal(session.mode, 'app-window');
});

test('重试后仍秒退 → 才退到默认浏览器（保底不变）', async () => {
  const opens = [];
  let launchCount = 0;
  const session = await runWorkbenchSession('http://127.0.0.1:9/', {
    ...WIN,
    profileDir: 'C:\\x\\browser-profile',
    minLifetimeMs: 300,
    log: () => {},
    launch: () => { launchCount += 1; return { child: fakeChild('fast-exit'), browser: 'edge.exe' }; },
    killStale: () => 1,
    open: () => { opens.push('default-browser'); },
  });
  assert.equal(launchCount, 2, 'exactly one retry');
  assert.equal(opens.length, 1, 'default browser only after retry also failed');
  assert.equal(session.mode, 'fallback-browser');
});

test('启动前必清残留（防交接秒退的根因消除）', async () => {
  const order = [];
  const children = [];
  const sessionPromise = runWorkbenchSession('http://127.0.0.1:9/', {
    ...WIN,
    profileDir: 'C:\\x\\browser-profile',
    minLifetimeMs: 300,
    log: () => {},
    launch: () => { order.push('launch'); const c = fakeChild('alive'); children.push(c); return { child: c, browser: 'edge.exe' }; },
    killStale: () => { order.push('kill'); return 0; },
    open: () => {},
  });
  await new Promise(r => setTimeout(r, 350));
  assert.deepEqual(order, ['kill', 'launch'], 'killStale must run before first launch');
  children.forEach(c => { c.exitCode = 0; c.emit('exit', 0); });
  await sessionPromise;
});
