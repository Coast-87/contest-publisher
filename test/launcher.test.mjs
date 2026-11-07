import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { defaultProfileDir, runWorkbenchSession } from '../src/launcher.mjs';

// 历史教训（三轮）：
// ① Edge 启动加速残留同 profile 实例 → spawn 40ms 交接秒退 → 旧逻辑误开默认浏览器；
// ② 按 profile 无差别杀进程 → 多实例互相残杀，软件打不开；
// ③ 本机 Edge 连全新 profile 都秒退（交接策略异常）→ Edge --app 路线整体不可靠。
// 终版：优先原生 WebView2 宿主（窗口归本进程，与浏览器无关）；缺失/秒退才落回
// Edge --app，且每次会话用一次性全新 profile，秒退换新 profile 重试一次。

function fakeChild(behavior) {
  const child = new EventEmitter();
  child.pid = 12345;
  child.exitCode = null; // 与真实 spawn 一致：运行中为 null，waitForExit 靠它区分
  if (behavior === 'fast-exit') setTimeout(() => { child.exitCode = 0; child.emit('exit', 0); }, 20);
  return child;
}

// 默认屏蔽原生宿主，让旧用例专注 Edge 路径语义。
const WIN = { platform: 'win32', nativeHost: () => null };

test('原生 WebView2 宿主存活 → app-window，完全不碰 Edge 路径', async () => {
  let edgeLaunches = 0;
  const host = fakeChild('alive');
  const sessionPromise = runWorkbenchSession('http://127.0.0.1:9/', {
    ...WIN,
    nativeHost: () => 'C:\\x\\ContestPublisher.WebView2Host.exe',
    spawnFn: () => host, // 假 spawn：不碰文件系统，宿主一直活着
    minLifetimeMs: 300,
    log: () => {},
    launch: () => { edgeLaunches += 1; return { child: fakeChild('fast-exit'), browser: 'edge.exe' }; },
    open: () => {},
  });
  await new Promise(r => setTimeout(r, 350));
  host.exitCode = 0;
  host.emit('exit', 0);
  const session = await sessionPromise;
  assert.equal(session.mode, 'app-window');
  assert.equal(session.native, true);
  assert.equal(edgeLaunches, 0, 'Edge path untouched when native host works');
});

test('原生宿主秒退 → 回退 Edge 路径（带一次性 profile）', async () => {
  const profiles = [];
  const opens = [];
  let edgeLaunches = 0;
  const edgeChildren = [];
  const sessionPromise = runWorkbenchSession('http://127.0.0.1:9/', {
    ...WIN,
    nativeHost: () => 'C:\\x\\ContestPublisher.WebView2Host.exe',
    profileDir: 'C:\\x\\bp-native',
    minLifetimeMs: 300,
    log: () => {},
    launch: (_url, { profileDir }) => { edgeLaunches += 1; profiles.push(profileDir); const c = fakeChild('alive'); edgeChildren.push(c); return { child: c, browser: 'edge.exe' }; },
    cleanup: () => {},
    open: () => {},
  });
  await new Promise(r => setTimeout(r, 100));
  assert.equal(edgeLaunches, 1, 'falls back to Edge path');
  assert.equal(profiles[0], 'C:\\x\\bp-native');
  edgeChildren.forEach(c => { c.exitCode = 0; c.emit('exit', 0); });
  // 秒退会话触发「换新 profile 重试」，重试窗口在收尾之后才创建——再补一波收尾。
  await new Promise(r => setTimeout(r, 200));
  edgeChildren.forEach(c => { if (c.exitCode === null) { c.exitCode = 0; c.emit('exit', 0); } });
  const session = await sessionPromise;
  assert.equal(opens.length, 0, 'no default browser while Edge windows were alive');
  assert.ok(profiles[1] && profiles[1].endsWith('-r2'), 'retry used a fresh profile');
  assert.ok(['app-window', 'fallback-browser'].includes(session.mode), 'session settles to a defined mode');
});

test('Edge 路径：秒退 → 换全新 profile 重试一次 → 存活，不开默认浏览器', async () => {
  const opens = [];
  const profiles = [];
  let launchCount = 0;
  const children = [];
  const cleanups = [];
  const sessionPromise = runWorkbenchSession('http://127.0.0.1:9/', {
    ...WIN,
    profileDir: 'C:\\x\\bp-1',
    minLifetimeMs: 300,
    log: () => {},
    launch: (_url, { profileDir }) => {
      launchCount += 1;
      profiles.push(profileDir);
      const c = fakeChild(launchCount === 1 ? 'fast-exit' : 'alive');
      children.push(c);
      return { child: c, browser: 'edge.exe' };
    },
    cleanup: dir => { cleanups.push(dir); },
    open: () => { opens.push('default-browser'); },
  });
  await new Promise(r => setTimeout(r, 400));
  assert.equal(launchCount, 2, 'retry once after fast exit');
  assert.notEqual(profiles[1], profiles[0], 'retry must use a different (fresh) profile');
  assert.equal(opens.length, 0, 'must not open default browser while retry is alive');
  children.forEach(c => { c.exitCode = 0; c.emit('exit', 0); });
  const session = await sessionPromise;
  assert.equal(session.mode, 'app-window');
  assert.deepEqual(cleanups, profiles, 'cleanup runs for both profile dirs at session end');
});

test('Edge 路径：重试仍秒退 → 才退到默认浏览器（保底不变）', async () => {
  const opens = [];
  let launchCount = 0;
  const session = await runWorkbenchSession('http://127.0.0.1:9/', {
    ...WIN,
    profileDir: 'C:\\x\\bp-2',
    minLifetimeMs: 300,
    log: () => {},
    launch: () => { launchCount += 1; return { child: fakeChild('fast-exit'), browser: 'edge.exe' }; },
    cleanup: () => {},
    open: () => { opens.push('default-browser'); },
  });
  assert.equal(launchCount, 2, 'exactly one retry');
  assert.equal(opens.length, 1, 'default browser only after retry also failed');
  assert.equal(session.mode, 'fallback-browser');
});

test('每次启动的 profile 目录唯一（根治交接秒退的根因）', () => {
  const a = defaultProfileDir({ platform: 'win32' });
  const b = defaultProfileDir({ platform: 'win32' });
  assert.notEqual(a, b, 'two calls must never share a profile dir');
  assert.match(a, /browser-profile-\d+-[0-9a-z]+-\d+$/, 'keeps the contest-publisher prefix');
});
