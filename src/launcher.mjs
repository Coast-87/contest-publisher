import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { PLATFORM, appWindowArgs, defaultLogDir, findChromium, openTarget, resolveSidecar } from './platform.mjs';

// Windows 没有可用的系统 WebView 壳（macOS 那边是 native/main.swift 的 WKWebView），
// 这里用 Edge/Chrome 的 --app 模式给出等价的「独立窗口」体验：没有地址栏、没有标签页。
// 窗口进程的存活就是会话的存活：窗口关掉 → 启动器退出 → 本地服务一起停。
//
// profile 策略：每次会话用「一次性全新目录」。Edge/Chrome 对「同 profile 已有实例」
// 会做 ProcessSingleton 交接——spawn 进程 ~40ms 内 exit 0，窗口归了别人（旧版就是被
// Edge 启动加速留下的残留实例坑成「双击两次才出窗口 + 叠开 web 端」）。全新 profile
// 下不存在交接对象，spawn 必然存活（实测）；会话结束顺手删目录，删不掉下次也没影响。
// 工作台配置有服务端同步（/api/settings），不依赖浏览器 localStorage 持久化。
let profileSeq = 0;
export function defaultProfileDir({ platform = PLATFORM, env = process.env } = {}) {
  const base = path.join(defaultLogDir({ platform, env }), 'browser-profile');
  // 进程内自增序号兜底同毫秒并发调用，保证每次会话目录必然唯一。
  return `${base}-${process.pid}-${Date.now().toString(36)}-${profileSeq += 1}`;
}

// 原生窗口宿主（WebView2，Win10/11 系统自带运行时）：窗口归本进程所有，与浏览器
// 完全无关——不存在 Edge 的进程交接/秒退/叠开默认浏览器这一整类问题。打包后放在
// 应用旁（sidecar 根目录）；找不到时启动器才落回 Edge --app 路径。
export function resolveNativeHost({ exists = existsSync, roots } = {}) {
  return resolveSidecar('ContestPublisher.WebView2Host.exe', { check: exists, roots });
}

export function launchWorkbenchWindow(url, { profileDir, platform = PLATFORM, env = process.env, exists = existsSync, spawnFn = spawn } = {}) {
  const browser = findChromium({ platform, env, exists });
  if (!browser) return null;
  const args = appWindowArgs(url, { profileDir });
  try {
    // 同上：不给 GUI 浏览器传 windowsHide（SW_HIDE 会藏掉 --app 窗口）。
    const child = spawnFn(browser, args, { stdio: 'ignore' });
    child.on('error', () => {});
    return { child, browser, args };
  } catch { return null; }
}

// 会话结束后删一次性 profile 目录（浏览器进程已退出，通常能删掉；失败忽略——
// 目录里只有缓存，残留只占点磁盘）。
export function cleanupProfileDir(profileDir, { platform = PLATFORM, rm = rmSync } = {}) {
  if (platform !== 'win32' || !profileDir) return;
  try { rm(profileDir, { recursive: true, force: true, maxRetries: 2 }); } catch { /* 下次无所谓 */ }
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
  cleanup = cleanupProfileDir,
  nativeHost = resolveNativeHost,
  spawnFn = spawn,
} = {}) {
  if (platform !== 'win32') {
    open(url, { platform, kind: 'url' });
    return { mode: 'fallback-browser', browser: null, reason: 'non-windows' };
  }
  // 优先原生 WebView2 窗口；宿主缺失（老包/未知环境）或秒退才走 Edge --app 路径。
  const hostPath = nativeHost({ platform });
  if (hostPath) {
    log(`原生窗口（WebView2）已启动：${hostPath}`);
    const nativeStarted = Date.now();
    try {
      // 禁止 windowsHide：Node 会把它变成 STARTUPINFO wShowWindow=SW_HIDE，宿主的
      // WinForms 首窗被系统隐藏——进程活着、日志正常、窗口永远看不见（2026-11-07 实测）。
      // 宿主是 -target:winexe，本就没有控制台可闪，不需要任何隐藏。
      const child = spawnFn(hostPath, [url], { stdio: 'ignore' });
      child.on('error', () => {});
      const nativeExit = await waitForExit(child);
      const nativeAlive = Date.now() - nativeStarted;
      if (nativeAlive >= minLifetimeMs) {
        return { mode: 'app-window', browser: hostPath, exitCode: nativeExit, aliveMs: nativeAlive, native: true };
      }
      log(`原生窗口 ${nativeAlive}ms 内退出（exit=${nativeExit}），回退 Edge --app 模式`);
    } catch (e) {
      log(`原生窗口启动失败：${e.message}，回退 Edge --app 模式`);
    }
  }
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
  let retried = false;
  // 秒退说明 URL 被交接给了别的实例（本会话 profile 是全新的，正常不该发生；
  // 保留一次重试兜底外部竞态）。重试换一个全新 profile，交接对象必然不存在。
  if (aliveMs < minLifetimeMs) {
    log(`窗口进程 ${aliveMs}ms 内退出（exit=${exitCode}），换全新 profile 重试`);
    retried = true;
    session = launch(url, { profileDir: `${profileDir}-r2`, platform, env });
    if (session) {
      log(`应用窗口重试启动：${session.browser}`);
      exitCode = await waitForExit(session.child);
      aliveMs = Date.now() - started;
    }
  }
  cleanup(profileDir, { platform });
  if (retried) cleanup(`${profileDir}-r2`, { platform });
  if (aliveMs < minLifetimeMs) {
    log(`应用窗口进程 ${aliveMs}ms 内退出（exit=${exitCode}），改用系统默认浏览器打开工作台`);
    open(url, { platform, kind: 'url' });
    return { mode: 'fallback-browser', browser: session?.browser, exitCode, aliveMs };
  }
  return { mode: 'app-window', browser: session?.browser, exitCode, aliveMs };
}

// 无控制窗口时（Windows 双击启动、--windows-hide-console 构建）stdout 写到哪里都看不见，
// 所以那个场景下把同样的信息写进启动器日志。
export function isHeadlessConsole({ platform = PLATFORM, isTTY = process.stdout?.isTTY } = {}) {
  return platform === 'win32' && !isTTY;
}
