import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { emptyGitConfig, hooksPathValue, knownNodePaths, whichSync } from './platform.mjs';
import { logDebug, logError, logInfo } from './logger.mjs';

export function run(command, args, options = {}) {
  const started = Date.now();
  // 记命令不记环境：token 之类都在 env 里，绝不落日志。
  logDebug('process', `执行: ${command} ${args.join(' ')}`, options.cwd ? `cwd=${options.cwd}` : undefined);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ms = Date.now() - started;
  if (result.error) {
    logError('process', `${command} 启动失败（${ms}ms）`, result.error.stack);
    throw new Error(`${command} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(-3000);
    logError('process', `${command} ${args.join(' ')} 退出码 ${result.status ?? result.signal}（${ms}ms）`, detail);
    throw new Error(`${command} ${args.join(' ')} exited ${result.status ?? result.signal}: ${detail}`);
  }
  logInfo('process', `${command} 完成 exit=0（${ms}ms）`);
  return result.stdout;
}

let hooksPathCache;
function gitHooksPath() {
  if (hooksPathCache) return hooksPathCache;
  const value = hooksPathValue();
  // Windows 上 git 没有 /dev/null 的概念，改指一个真实存在的空目录，效果同样是「没有钩子可执行」。
  if (value !== '/dev/null') { try { mkdirSync(value, { recursive: true }); } catch { /* 建不出来就让它自然找不到 */ } }
  return (hooksPathCache = value);
}

// 异步版 run：不阻塞事件循环。WebView2 宿主看门狗每 2s 探一次 /api/health，
// 连续失败约 10s 就关窗——spawnSync 一次跑十几秒（慢盘+杀软扫 86MB 运行时）会把
// 服务冻结到被看门狗误杀（2026-11-07 Lenovo 实锤）。长调用一律走这里。
export function runAsync(command, args, options = {}) {
  const started = Date.now();
  logDebug('process', `执行(异步): ${command} ${args.join(' ')}`, options.cwd ? `cwd=${options.cwd}` : undefined);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = ''; let stderr = ''; let settled = false;
    const CAP = 32 * 1024 * 1024;
    const timer = setTimeout(() => {
      settled = true;
      try { child.kill(); } catch { /* 已经死了 */ }
      logError('process', `${command} 超时被杀（${options.timeout ?? 120_000}ms）`);
      reject(new Error(`${command} timed out after ${options.timeout ?? 120_000}ms`));
    }, options.timeout ?? 120_000);
    child.stdout.on('data', chunk => { if (stdout.length < CAP) stdout += chunk; });
    child.stderr.on('data', chunk => { if (stderr.length < CAP) stderr += chunk; });
    child.on('error', error => {
      if (settled) return; settled = true; clearTimeout(timer);
      logError('process', `${command} 启动失败（${Date.now() - started}ms）`, error.stack);
      reject(new Error(`${command} failed to start: ${error.message}`));
    });
    child.on('close', (code, signal) => {
      if (settled) return; settled = true; clearTimeout(timer);
      const ms = Date.now() - started;
      if (code !== 0) {
        const detail = (stderr || stdout || '').trim().slice(-3000);
        logError('process', `${command} ${args.join(' ')} 退出码 ${code ?? signal}（${ms}ms）`, detail);
        reject(new Error(`${command} ${args.join(' ')} exited ${code ?? signal}: ${detail}`));
        return;
      }
      logInfo('process', `${command} 完成 exit=0（${ms}ms）`);
      resolve(stdout);
    });
  });
}

export function runNodeAsync(script, args = [], options = {}) {
  const { command, env } = resolveScriptRuntime();
  return runAsync(command, [script, ...args], { ...options, env: { ...(options.env ?? {}), ...env } });
}

// runGit 的异步版：clone/fetch/push 这类可跑几十秒到几分钟的操作必须走它，
// 否则 spawnSync 会把事件循环冻死（看门狗误杀窗口）。
export function runGitAsync(args, options = {}) {
  const secureEnv = options.secure === false ? (options.env ?? {}) : {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyGitConfig(),
    GIT_LFS_SKIP_SMUDGE: '1',
    ...(options.env ?? {}),
  };
  return runAsync('git', ['-c', `core.hooksPath=${gitHooksPath()}`, '-c', 'core.autocrlf=false', ...args], { ...options, env: secureEnv });
}

export function runGit(args, options = {}) {  const secureEnv = options.secure === false ? (options.env ?? {}) : {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyGitConfig(),
    GIT_LFS_SKIP_SMUDGE: '1',
    ...(options.env ?? {}),
  };
  // core.autocrlf：Git for Windows 默认开着它，会把检出和提交的行尾改写一遍，
  // 工作副本的字节就不再等于审计过的字节。本工具全程按字节比对，所以一律关掉（unix 上本就是 false）。
  // core.hooksPath：源仓库里可能带钩子，指向空处保证它们不会被执行。
  return run('git', ['-c', `core.hooksPath=${gitHooksPath()}`, '-c', 'core.autocrlf=false', ...args], { ...options, env: secureEnv });
}

let runtimeCache;
// 打包的 bun 二进制里 process.execPath 是应用自己，直接当 node 用会把脚本参数
// 喂给应用 CLI。按优先级解析一个能执行 node 风格脚本的运行时：
// CONTEST_PUBLISHER_NODE 覆盖 → 宿主本身是 node → PATH 里的 node → 常见安装位置
// → 兜底：应用自己以 BUN_BE_BUN=1 充当 bun 运行时（返回值带 env 标记）。
export function resolveScriptRuntime() {
  if (runtimeCache) return runtimeCache;
  const override = process.env.CONTEST_PUBLISHER_NODE?.trim();
  if (override) return (runtimeCache = { command: override, env: {} });
  if (!process.versions?.bun) return (runtimeCache = { command: process.execPath, env: {} });
  const found = whichSync('node');
  if (found) return (runtimeCache = { command: found, env: {} });
  for (const candidate of knownNodePaths()) {
    try { if (existsSync(candidate)) return (runtimeCache = { command: candidate, env: {} }); } catch {}
  }
  return (runtimeCache = { command: process.execPath, env: { BUN_BE_BUN: '1' } });
}

// 展示/拼接命令行用：解析出的运行时可执行文件。
export function nodeRuntime() {
  return resolveScriptRuntime().command;
}

export function runNode(script, args = [], options = {}) {
  const { command, env } = resolveScriptRuntime();
  return run(command, [script, ...args], { ...options, env: { ...(options.env ?? {}), ...env } });
}

// `node --check` 是纯语法检查；bun 的 `--check` 会真的执行文件，不能用，
// 兜底到内置 bun 时改用进程内 Transpiler 纯解析，不执行任何用户代码。
export function checkJsSyntax(file, code) {
  const { command, env } = resolveScriptRuntime();
  if (env.BUN_BE_BUN) {
    new Bun.Transpiler({ loader: 'js' }).transformSync(code ?? readFileSync(file, 'utf8'));
    return;
  }
  run(command, ['--check', file], { timeout: 30_000 });
}

export function resetScriptRuntimeCache() { runtimeCache = undefined; }

// checkJsSyntax 的异步版：verify 对每个 JS 文件拉起一次运行时做 --check，
// 慢盘+杀软环境下单次 5-15 秒（Lenovo 实测），spawnSync 连续两三个就能把
// 事件循环冻到超过看门狗阈值——auto-push 链路里必须走异步。
export async function checkJsSyntaxAsync(file, code) {
  const { command, env } = resolveScriptRuntime();
  if (env.BUN_BE_BUN) {
    new Bun.Transpiler({ loader: 'js' }).transformSync(code ?? readFileSync(file, 'utf8'));
    return;
  }
  await runAsync(command, ['--check', file], { timeout: 30_000 });
}
