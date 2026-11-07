import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PLATFORM, appWindowArgs, defaultLogDir, findChromium, openTarget } from './platform.mjs';

// Windows 没有可用的系统 WebView 壳（macOS 那边是 native/main.swift 的 WKWebView），
// 这里用 Edge/Chrome 的 --app 模式给出等价的「独立窗口」体验：没有地址栏、没有标签页。
// 窗口进程的存活就是会话的存活：窗口关掉 → 启动器退出 → 本地服务一起停。
export function defaultProfileDir({ platform = PLATFORM, env = process.env } = {}) {
  return path.join(defaultLogDir({ platform, env }), 'browser-profile');
}

// 杀掉所有命令行里带我们专用 profile 的浏览器进程（Edge 的「启动加速」会在窗口全关后
// 继续留一组 msedge.exe 挂着这个 profile；下次启动 spawn 会在 ~40ms 内把 URL 交接给
// 它并 exit 0，启动器就会误判「窗口不归我们管」而另开系统默认浏览器）。profile 是
// 工作台专属目录，杀掉不伤任何用户数据；只匹配 msedge.exe / chrome.exe 本体，
// 不碰 msedgewebview2.exe（别的应用在用）。
export function killProfileBrowserProcesses(profileDir, { platform = PLATFORM, spawnSyncFn = spawnSync } = {}) {
  if (platform !== 'win32') return 0;
  const needle = String(profileDir).replace(/'/g, "''");
  const script =
    '$procs = Get-CimInstance Win32_Process -Filter "Name=\'msedge.exe\' OR Name=\'chrome.exe\'" ' +
    "| Where-Object { \$_.CommandLine -like '*" + needle + "*' }; " +
    '$procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; ' +
    'Write-Output $procs.Count';
  try {
    const r = spawnSyncFn('powershell', ['-NoProfile', '-Command', script], { timeout: 20_000, windowsHide: true });
    const count = Number(String(r.stdout || '').trim());
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch { return 0; }
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  killStale = killProfileBrowserProcesses,
} = {}) {
  if (platform !== 'win32') {
    open(url, { platform, kind: 'url' });
    return { mode: 'fallback-browser', browser: null, reason: 'non-windows' };
  }
  // 启动前先清掉上一会话残留的浏览器进程（启动加速场景，见 killProfileBrowserProcesses
  // 注释），否则本次 spawn 必然秒退。清理数量写进日志，headless 时可查。
  const stale = killStale(profileDir, { platform });
  if (stale > 0) log(`已清理上会话残留的浏览器进程 ${stale} 个`);
  const started = Date.now();
  let session = launch(url, { profileDir, platform, env });
  if (!session) {
    log('未找到 Edge / Chrome，改用系统默认浏览器打开工作台');
    open(url, { platform, kind: 'url' });
    return { mode: 'fallback-browser', browser: null, reason: 'no-chromium' };
  }
  log(`应用窗口已启动：${session.browser}`);
  let exitCode = await waitForExit(session.child);
  let aliveMs = Date.now() - started;
  // 启动进程秒退通常意味着它把 URL 交接给了另一个实例（窗口并没有归我们管）。
  // 先清残留再重试一次（覆盖清理与 spawn 之间又产生交接的窄窗口）；仍秒退才退到默认浏览器。
  if (aliveMs < minLifetimeMs) {
    const stale2 = killStale(profileDir, { platform });
    if (stale2 > 0) log(`窗口进程 ${aliveMs}ms 内退出（exit=${exitCode}），清理残留 ${stale2} 个后重试`);
    session = launch(url, { profileDir, platform, env });
    if (session) {
      log(`应用窗口重试启动：${session.browser}`);
      exitCode = await waitForExit(session.child);
      aliveMs = Date.now() - started;
    }
  }
  // 会话结束（窗口关闭）后把仍挂着本 profile 的浏览器进程清干净，防止「启动加速」
  // 把它们留到下次启动变成秒退源。
  const stale3 = killStale(profileDir, { platform });
  if (stale3 > 0) log(`会话结束后清理残留浏览器进程 ${stale3} 个`);
  if (aliveMs < minLifetimeMs) {
    log(`应用窗口进程 ${aliveMs}ms 内退出（exit=${exitCode}），改用系统默认浏览器打开工作台`);
    open(url, { platform, kind: 'url' });
    return { mode: 'fallback-browser', browser: session?.browser, exitCode, aliveMs };
  }
  return { mode: 'app-window', browser: session?.browser, exitCode, aliveMs };
}

// 无控制台窗口时（Windows 双击启动、--windows-hide-console 构建）stdout 写到哪里都看不见，
// 所以那个场景下把同样的信息写进启动器日志。
export function isHeadlessConsole({ platform = PLATFORM, isTTY = process.stdout?.isTTY } = {}) {
  return platform === 'win32' && !isTTY;
}
