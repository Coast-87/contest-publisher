// 全流程本地日志：所有模块共用一个入口，按天落盘到 %LOCALAPPDATA%\Contest Publisher\logs\，
// 保留最近 LOG_RETENTION_DAYS 天。打包/双击场景没有控制台，出问题全靠这批文件定位。
// 级别用 CONTEST_PUBLISHER_LOG_LEVEL 覆盖（debug|info|warn|error，默认 info）；
// debug 会额外记录每次 API 请求和子进程 stdout 摘要。
import { appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { defaultLogDir } from './platform.mjs';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LOG_RETENTION_DAYS = 14;

let cachedLevel;
function logLevel() {
  if (cachedLevel) return cachedLevel;
  const raw = String(process.env.CONTEST_PUBLISHER_LOG_LEVEL ?? 'info').trim().toLowerCase();
  return (cachedLevel = LEVELS[raw] ? raw : 'info');
}

function logDir({ env = process.env, home = os.homedir() } = {}) {
  return path.join(defaultLogDir({ env, home }), 'logs');
}

function dayStamp(date) {
  return date.toISOString().slice(0, 10);
}

// 首次写入时清理过期日志；按文件名里的日期判断，失败不影响主流程。
let pruned = false;
function pruneOldLogs(dir) {
  if (pruned) return;
  pruned = true;
  const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 3600 * 1000);
  const cutoffStamp = dayStamp(cutoff);
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const match = /^(app|launcher|webview2-host)-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
    if (!match || match[2] >= cutoffStamp) continue;
    try { unlinkSync(path.join(dir, name)); } catch { /* 占用中就留着下次删 */ }
  }
}

function formatValue(value) {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function append(level, module, message, detail) {
  if (LEVELS[level] < LEVELS[logLevel()]) return;
  const dir = logDir();
  const now = new Date();
  const stamp = dayStamp(now);
  try {
    mkdirSync(dir, { recursive: true });
    pruneOldLogs(dir);
    const parts = [now.toISOString(), `[${level.toUpperCase()}]`, `[${module}]`, String(message)];
    const formatted = formatValue(detail);
    if (formatted) parts.push(formatted);
    appendFileSync(path.join(dir, `app-${stamp}.log`), `${parts.join(' ')}\n`, 'utf8');
  } catch { /* 日志失败永远不影响主流程 */ }
}

export function logDebug(module, message, detail) { append('debug', module, message, detail); }
export function logInfo(module, message, detail) { append('info', module, message, detail); }
export function logWarn(module, message, detail) { append('warn', module, message, detail); }
export function logError(module, message, detail) { append('error', module, message, detail); }

// 错误统一格式化：带完整堆栈，方便定位。
export function describeError(error) {
  if (error instanceof Error) return `${error.message}\n${error.stack ?? ''}`;
  return String(error);
}

// 耗时统计：startTimer 返回的函数带着名字调用即记一条「完成/失败 + 耗时」。
export function startTimer(module, operation) {
  const started = Date.now();
  return (outcome, detail) => {
    const ms = Date.now() - started;
    const message = `${operation} ${outcome}${ms >= 2000 ? `（${(ms / 1000).toFixed(1)}s）` : `（${ms}ms）`}`;
    if (outcome === '失败') logError(module, message, detail);
    else logInfo(module, message, detail);
  };
}
