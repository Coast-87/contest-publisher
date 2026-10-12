import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PLATFORM, appWindowArgs, defaultLogDir, findChromium, openTarget } from './platform.mjs';

// Windows 没有可用的系统 WebView 壳（macOS 那边是 native/main.swift 的 WKWebView），
// 这里用 Edge/Chrome 的 --app 模式给出等价的「独立窗口」体验：没有地址栏、没有标签页。
// 窗口进程的存活就是会话的存活：窗口关掉 → 启动器退出 → 本地服务一起停。
export function defaultProfileDir({ platform = PLATFORM, env = process.env } = {}) {
  return path.join(defaultLogDir({ platform, env }), 'browser-profile');
}

export function launchWorkbenchWindow(url, { profileDir, platform = PLATFORM, env = process.env, exists = existsSync, spawnFn = spawn } = {}) {
  const browser = findChromium({ platform, env, exists });
  if (!browser) return null;
  const args = appWindowArgs(url, { profileDir });
  try {
    const child = spawnFn(browser, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    return { child, browser, args };
  } catch { return null; }
}

function waitForExit(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve(child?.exitCode ?? null);
    child.once('exit', code => resolve(code ?? 0));
    child.once('error', () => resolve(null));
  });
}

// 返回 { mode }：app-window 表示用户关掉了应用窗口，调用方应当结束进程；
// fallback-browser 表示只打开了默认浏览器，窗口存活无法观测，调用方必须保持服务运行。
export async function runWorkbenchSession(url, {
  platform = PLATFORM,
  env = process.env,
  profileDir = defaultProfileDir({ platform, env }),
  minLifetimeMs = 5000,
  log = () => {},
  launch = launchWorkbenchWindow,
  open = openTarget,
} = {}) {
  if (platform !== 'win32') {
    open(url, { platform, kind: 'url' });
    return { mode: 'fallback-browser', browser: null, reason: 'non-windows' };
  }
  const session = launch(url, { profileDir, platform, env });
  if (!session) {
    log('未找到 Edge / Chrome，改用系统默认浏览器打开工作台');
    open(url, { platform, kind: 'url' });
    return { mode: 'fallback-browser', browser: null, reason: 'no-chromium' };
  }
  log(`应用窗口已启动：${session.browser}`);
  const started = Date.now();
  const exitCode = await waitForExit(session.child);
  const aliveMs = Date.now() - started;
  // 启动进程秒退通常意味着它把 URL 交接给了另一个实例（窗口并没有归我们管），
  // 这种情况下不能关服务，否则用户刚看到的页面立刻断掉。
  if (aliveMs < minLifetimeMs) {
    log(`应用窗口进程 ${aliveMs}ms 内退出（exit=${exitCode}），改用系统默认浏览器打开工作台`);
    open(url, { platform, kind: 'url' });
    return { mode: 'fallback-browser', browser: session.browser, exitCode, aliveMs };
  }
  return { mode: 'app-window', browser: session.browser, exitCode, aliveMs };
}

// 无控制台窗口时（Windows 双击启动、--windows-hide-console 构建）stdout 写到哪里都看不见，
// 所以那个场景下把同样的信息写进启动器日志。
export function isHeadlessConsole({ platform = PLATFORM, isTTY = process.stdout?.isTTY } = {}) {
  return platform === 'win32' && !isTTY;
}
