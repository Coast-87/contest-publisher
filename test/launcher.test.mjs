import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { defaultProfileDir, runWorkbenchSession } from '../src/launcher.mjs';

// 历史教训（两轮）：
// ① Edge 启动加速残留同 profile 实例 → spawn 40ms 交接秒退 → 旧逻辑误开默认浏览器；
// ② 按 profile 无差别杀进程 → 多实例互相残杀（B 的启动清理杀掉 A 正开着的窗口）。
// 终版方案：不用杀进程——每次会话用一次性全新 profile（无交接对象，spawn 必存活），
// 秒退换新 profile 重试一次，仍秒退才退默认浏览器。

function fakeChild(behavior) {
  const child = new EventEmitter();
  child.pid = 12345;
  child.exitCode = null; // 与真实 spawn 一致：运行中为 null，waitForExit 靠它区分
  if (behavior === 'fast-exit') setTimeout(() => { child.exitCode = 0; child.emit('exit', 0); }, 20);
  return child;
}

const WIN = { platform: 'win32' };

test('秒退 → 换全新 profile 重试一次 → 存活，不开默认浏览器', async () => {
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
  assert.ok(profiles[1].startsWith(profiles[0]), 'retry profile is derived from the session profile');
  assert.equal(opens.length, 0, 'must not open default browser while retry is alive');
  children.forEach(c => { c.exitCode = 0; c.emit('exit', 0); });
  const session = await sessionPromise;
  assert.equal(session.mode, 'app-window');
  assert.deepEqual(cleanups, profiles, 'cleanup runs for both profile dirs at session end');
});

test('重试仍秒退 → 才退到默认浏览器（保底不变）', async () => {
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
  assert.ok(a.includes('browser-profile-'), 'keeps the contest-publisher prefix');
});
