import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { emptyGitConfig, hooksPathValue, knownNodePaths, whichSync } from './platform.mjs';

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(-3000);
    throw new Error(`${command} ${args.join(' ')} exited ${result.status ?? result.signal}: ${detail}`);
  }
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

export function runGit(args, options = {}) {
  const secureEnv = options.secure === false ? (options.env ?? {}) : {
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
