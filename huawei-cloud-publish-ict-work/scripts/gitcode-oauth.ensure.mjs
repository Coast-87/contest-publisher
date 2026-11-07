#!/usr/bin/env node
// gitcode-oauth.ensure.mjs — GitCode OAuth 登录闭环（两阶段，跨平台，Node 原生不依赖 bash）
//
// 背景:
//   外部 skill gitcode-oauth 是「Go 二进制 + bash 脚本」的多步协议（serve → login/start 取二维码 →
//   poll → finish 写 token）。SKILL 描述容易被智能体忽略、自行脑补（伪造 token / 误存敏感字段）；
//   Windows 下 bash 脚本原生跑不了。本脚本把完整登录闭环封装为一条命令：
//
//   ⚠️ 单命令阻塞陷阱：原实现「start serve → 打印链接 → 同步轮询 ≤300s」会让 shell 调用一直不返回，
//      agent 拿不到链接也无从提示用户，看起来像卡死。现拆为两阶段：
//
//   阶段 1 `--start`（无参默认）：有 token → `#oauth=ready`；无 token → 起 serve + 创建会话，
//      打印 `#oauth=started session_id=<id> login_url=<url>`（stdout）后**立即退出**。
//     agent 把链接和二维码一并给用户：二维码为 best-effort（serve 返回纯 Unicode 块字符 █▀▄，
//     净化+等宽化后请放入等宽代码块展示，勿让 Markdown 折叠空格）；展示异常（乱码/断行/缩进塌陷）
//     直接给 login_url，链接始终为主路径（禁止 agent 内置浏览器代开）。
//   阶段 2 `--wait <session_id>`：轮询同一 serve（127.0.0.1:7654）至授权完成 → finish → 写 token →
//      `#oauth=done`；超时/失败 → `#oauth=failed reason=...`。
//
// 二进制发现优先级:
//   ~/.local/bin/gitcode-oauth        (Linux/macOS 默认)
//   ~/bin/gitcode-oauth.exe           (Windows，install.sh 目标)
//   GITCODE_OAUTH_BIN 环境变量         显式指定
//   PATH 上的 gitcode-oauth / gitcode-oauth.exe
//   （路径解析统一走 ensure-user-tool.mjs：cache→PATH→预装路径→bindir→自动安装）
//
// serve 端口: 127.0.0.1:7654（与外部 skill 一致）。serve 以 detached 后台进程存活，pid 写临时文件，
//   `--wait` 结束（done/failed/timed out）后自动清理。
// 退出码: 0=ready/started/done; 1=absent(未装) 或失败; 2=参数错误

import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync, unlinkSync, openSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (platform() === "win32") {
  process.stdout.setDefaultEncoding?.("utf8");
  process.stderr.setDefaultEncoding?.("utf8");
}

const SERVER_URL = "http://127.0.0.1:7654";
const POLL_TIMEOUT_MS = 300_000;
const SERVE_PID_FILE = path.join(tmpdir(), "gitcode-oauth-serve.pid");
const SERVE_LOG_FILE = path.join(tmpdir(), "gitcode-oauth-serve.log");
const isWin = platform() === "win32";

// ---- 参数 ----
const args = process.argv.slice(2);
let quiet = false;
let mode = "start";          // start | wait
let waitSession = "";
let waitTimeoutMs = POLL_TIMEOUT_MS;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "-h" || a === "--help") {
    console.log(`gitcode-oauth.ensure.mjs — GitCode OAuth 登录闭环（默认两阶段；也可一条命令跑完）

用法:
  A. 推荐（一条命令跑完；建议以后台任务运行，避免 --wait 被工具中断带走 serve）:
     node gitcode-oauth.ensure.mjs --login [--timeout <秒>]
     # 先打印 #oauth=started session_id=<id> login_url=<url>（可流式读取），二维码走 stderr（best-effort）
     # 把链接/二维码交给用户后，本进程继续轮询 → 成功 #oauth=done（token 已写 ~/.gitcode/auth.toml）
  B. 两阶段（旧流程，仍兼容）:
     node gitcode-oauth.ensure.mjs --start              # 起 serve + 拿链接后立即返回（serve 后台存活）
     node gitcode-oauth.ensure.mjs --wait <session_id> [--timeout <秒>]
  C. 清理:
     node gitcode-oauth.ensure.mjs --stop               # 结束后台 serve（放弃登录时用）

选项:
  --login              起 serve + 打印链接 + 阻塞轮询至授权完成（推荐；适合后台运行）
  --start              仅阶段 1（默认）
  --wait <session_id>  仅阶段 2，轮询指定会话
  --timeout <秒>       --login / --wait 的轮询时长（默认 300）
  --stop               杀掉后台 serve 并清理 pid/日志（幂等）
  --quiet              静默（stdout 仅结果行）
  -h, --help           帮助

中断语义（重要）:
  --login / --wait 超时、异常、Ctrl+C 都**不会**杀 serve——serve 保留在后台，用户完成授权后重跑
  --wait <session_id> 即可续上（token 落盘前不要重新 --start，那会换掉 session/链接）。
  只有两种情况会清理 serve：① #oauth=done 成功后；② 显式 --stop。

环境变量: GITCODE_OAUTH_BIN（显式指定二进制路径）；GITCODE_HOME（auth.toml 目录）
退出码: 0=ready/started/done/stopped; 1=absent/失败; 2=参数错误`);
    process.exit(0);
  } else if (a === "--quiet") quiet = true;
  else if (a === "--start") mode = "start";
  else if (a === "--login") mode = "login";
  else if (a === "--stop") mode = "stop";
  else if (a === "--wait") { mode = "wait"; waitSession = args[++i] || ""; }
  else if (a === "--timeout") { const n = Number(args[++i]); if (n > 0) waitTimeoutMs = n * 1000; }
  else { console.error(`❌ 未知参数: ${a}`); process.exit(2); }
}

const log = quiet ? () => {} : (m) => console.error(`[gitcode-oauth] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 中断/终止**不杀 serve**：serve 是 detached 后台进程，只有保留它，用户授权后才能用 --wait 续上
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.error(`\n⚠️ 收到 ${sig}：后台 serve 保留（pid=${pidFilePid() || "?"}），未完成的授权可重跑 --wait <session_id> 续上；放弃时跑 --stop 清理。`);
    process.exit(130);
  });
}

// ---- 工具 ----
function findBinary() {
  if (process.env.GITCODE_OAUTH_BIN && existsSync(process.env.GITCODE_OAUTH_BIN)) {
    return process.env.GITCODE_OAUTH_BIN;
  }
  try {
    const out = execSync(`node "${path.join(path.dirname(fileURLToPath(import.meta.url)), "ensure-user-tool.mjs")}" --tool gitcode-oauth`, {
      encoding: "utf8", timeout: 200000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.match(/#tool=gitcode-oauth path=(\S+)/)?.[1] || "";
  } catch {
    return "";
  }
}

function authFile() {
  return path.join(process.env.GITCODE_HOME || path.join(homedir(), ".gitcode"), "auth.toml");
}
const AUTH_FILE = authFile();

// ---- serve 生命周期（detached 后台进程，pid 落盘供 --wait 复用/清理）----
let serveProc = null;

function pidFilePid() {
  try {
    const raw = readFileSync(SERVE_PID_FILE, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch { return 0; }
}

function tryCmd(cmd) {
  try { return execSync(cmd, { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { return ""; }
}

// 探测 7654 端口由哪些进程监听（跨平台）。返回 PID 数组；空 = 无人监听。
function portPidsOn(port) {
  try {
    if (isWin) {
      const out = tryCmd(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`);
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const m = line.trim().match(/(\d+)\s*$/);
        if (m) pids.add(Number(m[1]));
      }
      return [...pids];
    }
    // Linux: lsof → 回退 fuser → 回退 ss
    let out = tryCmd(`lsof -ti tcp:${port}`);
    if (!out) out = tryCmd(`fuser ${port}/tcp 2>/dev/null`);
    if (!out) out = tryCmd(`ss -ltnp 'sport = :${port}'`);
    const pids = new Set();
    if (out) {
      for (const m of out.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
      for (const t of out.split(/[\s,]+/)) if (/^\d+$/.test(t)) pids.add(Number(t));
    }
    return [...pids];
  } catch { return []; }
}

async function waitServer() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${SERVER_URL}/login/poll`, { signal: AbortSignal.timeout(800) });
      // 服务就绪判据：收到任何 HTTP 响应即视为已监听（400 参数错误也算服务在线）
      if (res) return true;
    } catch {}
    await sleep(400);
  }
  return false;
}

// 快速单次 HTTP 探测（serve 是否真的可响应），不等长轮询
async function httpOk() {
  try {
    const res = await fetch(`${SERVER_URL}/login/poll`, { signal: AbortSignal.timeout(800) });
    return !!res;
  } catch { return false; }
}

async function ensureServeUp(bin) {
  // 1) 端口已监听且 serve 可响应 → 直接复用（上次 --start 的后台 serve 或外部进程）
  if (await httpOk()) return true;

  // 2) 端口被僵尸进程占用（监听但不响应）→ 清理后重启，避免 bind 失败
  const occupying = portPidsOn(7654);
  if (occupying.length > 0) {
    log(`端口 7654 被进程 pid=${occupying.join(", ")} 占用且 serve 不响应，清理后重启`);
    for (const pid of occupying) if (pid > 0) forceKill(pid);
    // 等端口释放（最多约 5s）
    for (let i = 0; i < 10 && portPidsOn(7654).length > 0; i++) await sleep(500);
  }
  try { unlinkSync(SERVE_PID_FILE); } catch {}

  // 3) spawn detached serve
  try {
    let logFd;
    try { logFd = openSync(SERVE_LOG_FILE, "a"); } catch { logFd = "ignore"; }
    serveProc = spawn(bin, ["serve"], { detached: true, stdio: ["ignore", logFd, logFd], windowsHide: true });
    if (logFd !== "ignore") try { logFd.close?.(); } catch {}
    serveProc.unref();
    try { writeFileSync(SERVE_PID_FILE, String(serveProc.pid), "utf8"); } catch {}
  } catch (e) {
    log(`serve 启动失败: ${e?.message || e}`);
    return false;
  }

  // 4) 等端口真实监听 + HTTP 可响应（修复 spawn 后立即 fetch 的竞态，最多约 12s）
  for (let i = 0; i < 30; i++) {
    if (portPidsOn(7654).length > 0) break;
    if (serveProc && serveProc.exitCode !== null) {
      log(`serve 进程已退出（code=${serveProc.exitCode}），端口未就绪`);
      break;
    }
    await sleep(400);
  }
  if (await httpOk()) {
    log(`serve 已启动（pid=${serveProc.pid}，日志 ${SERVE_LOG_FILE}）`);
    return true;
  }
  log(`serve 未能在超时内就绪，日志: ${SERVE_LOG_FILE}`);
  return false;
}

async function loginStart() {
  const res = await fetch(`${SERVER_URL}/login/start`, { method: "POST", signal: AbortSignal.timeout(8000) });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

// ---- 阶段 1：--start（起 serve + 打印链接后立即退出，非阻塞）----
async function doStart(bin) {
  if (!(await ensureServeUp(bin))) {
    console.log("#oauth=failed reason=server");
    console.error(`无法访问或启动 ${SERVER_URL} 的 gitcode-oauth serve。日志: ${SERVE_LOG_FILE}`);
    process.exit(1);
  }
  let start;
  try {
    start = await loginStart();
  } catch (e) {
    console.log("#oauth=failed reason=start");
    console.error(`login/start 失败: ${e && e.message}`);
    process.exit(1);
  }
  const sessionId = start.session_id || "";
  if (!sessionId) {
    console.log("#oauth=failed reason=start");
    console.error("login/start 响应缺 session_id");
    process.exit(1);
  }
  const loginUrl = start.login_url || "";
  console.log(`#oauth=started session_id=${sessionId} login_url=${loginUrl}`);
  // stderr 的二维码/动画可能含 \r 刷新或 ANSI 清屏，把上面的状态行冲掉（tail/终端抓不到链接）。
  // 因此在 stdout 把关键信息单独再打一行，保证无论 stderr 怎么刷屏，登录链接一定可见。
  console.log(`login_url=${loginUrl}`);
  printLoginPrompt({ loginUrl, qrCode: start.qr_code, sessionId, blocking: false });
  process.exit(0);
}

// 链接 / 二维码 / 纪律（--start 与 --login 共用）
function printLoginPrompt({ loginUrl, qrCode, sessionId, blocking }) {
  console.error(`👇 请在浏览器打开以下链接，或扫码完成 GitCode 授权（最多 ${Math.round(waitTimeoutMs / 1000)}s）：`);
  console.error(`   登录链接: ${loginUrl || "(无)"}`);
  // 二维码（best-effort）：serve 返回纯 Unicode 块字符（█ ▀ ▄ + 空格，无 ANSI、无飞行串）。
  // 净化 + 等宽化后再输出，保证贴进等宽代码块即可对齐一维扫出；异常则降级纯链接。
  const qrText = qrCode ? normalizeQrText(qrCode) : "";
  if (qrText) {
    console.error(`   二维码（请放入等宽代码块展示，勿让 Markdown 折叠空格）：`);
    console.error(`\n${qrText}\n`);
  } else {
    console.error(`⚠️ 二维码文本缺失或不可用，直接用上面的登录链接即可。`);
  }
  console.error(`⚠️ 链接始终为主路径：二维码仅供便利，若渲染成乱码/断行/缩进塌陷，直接给链接由用户在浏览器打开授权；禁止用 agent 内置浏览器代开。`);
  if (blocking) {
    console.error(`   ⏳ 本进程会阻塞到授权完成或超时（建议以后台任务方式运行本命令，再从输出读取链接）。`);
    console.error(`   超时/中断都不会杀掉后台 serve：重跑 --wait ${sessionId} 可续上；放弃时 --stop 清理。`);
  } else {
    console.error(`   用户授权完成后，执行收尾轮询：`);
    console.error(`   node <skill>/scripts/gitcode-oauth.ensure.mjs --wait ${sessionId}`);
  }
}

// ---- 阶段 1+2 合并：--login（一条命令跑完；适合后台运行）----
async function doLogin(bin) {
  if (!(await ensureServeUp(bin))) {
    console.log("#oauth=failed reason=server");
    console.error(`无法访问或启动 ${SERVER_URL} 的 gitcode-oauth serve。日志: ${SERVE_LOG_FILE}`);
    process.exit(1);
  }
  let start;
  try {
    start = await loginStart();
  } catch (e) {
    console.log("#oauth=failed reason=start");
    console.error(`login/start 失败: ${e && e.message}`);
    process.exit(1);
  }
  const sessionId = start.session_id || "";
  if (!sessionId) {
    console.log("#oauth=failed reason=start");
    console.error("login/start 响应缺 session_id");
    process.exit(1);
  }
  const loginUrl = start.login_url || "";
  console.log(`#oauth=started session_id=${sessionId} login_url=${loginUrl}`);
  console.log(`login_url=${loginUrl}`);
  printLoginPrompt({ loginUrl, qrCode: start.qr_code, sessionId, blocking: true });
  await doWait(sessionId);
}

// ---- 阶段 2：--wait（轮询至授权完成 → finish → 写 token；失败/超时**不杀 serve**，便于续上）----
async function doWait(sessionId) {
  if (!sessionId) {
    console.error("❌ --wait 需要 <session_id>（从 --start 输出拿）");
    process.exit(2);
  }
  const deadline = Date.now() + waitTimeoutMs;
  let authorized = false;
  let lastBody = "";
  let pollCount = 0;
  let connErrs = 0;
  let serveDead = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER_URL}/login/poll?session_id=${encodeURIComponent(sessionId)}`, { signal: AbortSignal.timeout(5000) });
      const body = await res.text();
      connErrs = 0;
      pollCount++;
      // 首次 + 响应变化 + 每 30 次（~60s）打印一行，便于 agent 判断仍在推进
      if (pollCount === 1 || body !== lastBody || pollCount % 30 === 0) {
        log(`poll #${pollCount}: HTTP ${res.status}, body=${body.slice(0, 200)}`);
        lastBody = body;
      }
      // 成功判定（宽匹配）：关键词 OR 响应含 access_token/token 字段 OR JSON status 字段
      if (/approved|authorized|success|completed|done|granted/i.test(body)) { authorized = true; break; }
      if (res.ok && /access_token|"token"\s*:|\"token\"/i.test(body)) { authorized = true; break; }
      try {
        const j = JSON.parse(body);
        const st = String(j.status || j.state || j.message || "").toLowerCase();
        if (st && /approved|authorized|success|completed|done|granted|ok/.test(st)) { authorized = true; break; }
      } catch {}
      // 失败判定
      if (/expired|denied|fail|error/i.test(body) && !/waiting|pending/i.test(body)) { break; }
    } catch (e) {
      connErrs++;
      // 连续失败（serve 已死）：不静默，提示并继续到超时
      if (connErrs === 1 || (pollCount + 1) % 30 === 0) {
        log(`poll #${pollCount + 1} 请求失败: ${e?.message || e}`);
      }
      pollCount++;
      // 本地 serve 连续 5 次（~10s）不可达 → 判定 serve 已死，立即失败并给恢复指引（不要死等 5 分钟）
      if (connErrs >= 5) { serveDead = true; break; }
    }
    // 每 8 次（~15s）打一行，让 agent 知道仍在等待而非卡死
    if (!quiet && pollCount > 0 && pollCount % 8 === 0) {
      log(`仍在等待用户授权...（${Math.round((deadline - Date.now()) / 1000)}s 剩余）`);
    }
    await sleep(2000);
  }

  if (!authorized) {
    // 关键：超时 / serve 已死都**不清理 serve**（清了 session 就废了，用户授权完也收不到 token）
    console.log(`#oauth=failed reason=${serveDead ? "serve-dead" : "timeout"}`);
    if (serveDead) {
      console.error(`后台 serve 已不可达（连续 ${connErrs} 次请求失败）——它所在的后台任务/终端多半被中断带走了（Windows 上工具中断会按进程树连坐）。
  处置：① 先查 token 是否已落盘：node $SKILL_DIR/scripts/ensure-gitcode-credential.mjs（#credential=found 即已落盘，无需再登录）
        ② 未落盘 → 重跑 --login（或 --start 重新拿链接；session_id 会变，需用户重新授权）
        ③ 残留服务可跑 --stop 清理。`);
    } else {
      console.error(`等待授权超时（${pollCount} 次轮询，最后响应: ${lastBody.slice(0, 200) || "(无)"}）。
  后台 serve 仍存活（pid=${pidFilePid() || "?"}）：用户完成授权后重跑 --wait ${sessionId} 即可续上（token 落盘前**不要**重新 --start，那会换掉 session）。
  放弃登录可跑 --stop 清理。`);
    }
    process.exit(1);
  }

  // finish → 取 token
  let finish;
  try {
    const res = await fetch(`${SERVER_URL}/login/finish?session_id=${encodeURIComponent(sessionId)}`, { signal: AbortSignal.timeout(8000) });
    finish = await res.json();
  } catch (e) {
    console.log("#oauth=failed reason=finish");
    console.error(`login/finish 失败: ${e && e.message}\n   serve 保留（pid=${pidFilePid() || "?"}）：可直接重跑 --wait ${sessionId} 续上；放弃时 --stop。`);
    process.exit(1);
  }
  const token = finish.access_token || "";
  if (!token) {
    console.log("#oauth=failed reason=token");
    console.error(`login/finish 响应缺 access_token。serve 保留：可重跑 --wait ${sessionId} 续上；放弃时 --stop。`);
    process.exit(1);
  }

  // 写 ~/.gitcode/auth.toml（与外部 skill 同构：access_token/token_type/expires_in/[user]）
  writeAuthToml(finish, token);

  stopServe();
  console.log("#oauth=done");
  console.error(`✅ GitCode 授权成功，token 已保存到 ${AUTH_FILE}（权限 0600）。
安全提示：此文件可冒充你的身份，请勿分享。`);
  process.exit(0);
}

function writeAuthToml(finish, token) {
  const dir = path.dirname(AUTH_FILE);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const user = finish.user || {};
  const lines = [
    `access_token  = "${token}"`,
    `refresh_token = "${finish.refresh_token || ""}"`,
    `token_type    = "${finish.token_type || "bearer"}"`,
    `expires_in    = ${Number(finish.expires_in) || 0}`,
    `created_at    = ${Math.floor(Date.now() / 1000)}`,
    `\n[user]`,
    `id         = ${user.id ?? 0}`,
    `login      = "${user.login || ""}"`,
    `name       = "${user.name || ""}"`,
    `email      = "${user.email || ""}"`,
    `avatar_url = "${user.avatar_url || ""}"`,
  ].join("\n");
  const tmp = `${AUTH_FILE}.tmp-${process.pid}`;
  writeFileSync(tmp, lines, { encoding: "utf8", mode: 0o600 });
  // 尽力确保权限位（Windows 忽略；POSIX 显式 0600）
  try { if (!isWin) chmodSync(tmp, 0o600); } catch {}
  renameSync(tmp, AUTH_FILE);
}

function forceKill(pid) {
  if (!pid || pid <= 0) return;
  try {
    if (isWin) execSync(`taskkill /T /PID ${pid} /F`, { stdio: "ignore", timeout: 10000 });
    else process.kill(pid, "SIGKILL");
  } catch {}
}

function stopServe() {
  // 杀掉本次 spawn 的 serve
  if (serveProc) {
    try { serveProc.kill(); } catch {}
    serveProc = null;
  }
  // 杀掉 pid 文件记录的 detached serve
  forceKill(pidFilePid());
  try { unlinkSync(SERVE_PID_FILE); } catch {}
}

// ---- --stop：显式结束后台 serve（幂等；pid 文件 + 端口占用双来源，防 pid 文件丢失）----
function doStop() {
  const pids = new Set();
  const fromFile = pidFilePid();
  if (fromFile) pids.add(fromFile);
  for (const p of portPidsOn(7654)) if (p > 0) pids.add(p);
  for (const pid of pids) forceKill(pid);
  try { unlinkSync(SERVE_PID_FILE); } catch {}
  console.log(`#oauth=stopped killed=${[...pids].join(",") || "none"}`);
  if (pids.size === 0) console.error("ℹ️ 未发现运行中的 gitcode-oauth serve（无需清理）。");
  process.exit(0);
}

// 二维码文本净化（best-effort）：
//   ① 若含 ANSI/ESC 或 \r 刷新残留 → 放弃重建返回空串（无法可靠还原，降级纯链接）
//   ② 只允许块字符 █ ▀ ▄ 与空格；其余可视字符视为损坏
//   ③ 等宽化：每行补齐到最大行宽，避免通道剥尾随空格后行列失衡
// 返回空串 = 文本不可扫，调用方应降级为纯链接展示。
const QR_GLYPH = new Set(["█", "▀", "▄", " "]);
function normalizeQrText(raw) {
  const str = String(raw);
  if (str.includes("\x1b") || str.includes("\r")) return "";
  const lines = str
    .replace(/\t/g, " ")
    .replace(/[ \t]+$/gm, "")
    .split(/\n+/);
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const height = lines.length;
  if (height < 9) return "";
  const width = Math.max(...lines.map((l) => [...l].length));
  if (width < 9) return "";
  const out = [];
  for (const line of lines) {
    const chars = [...line];
    for (let x = 0; x < width; x++) {
      const c = x < chars.length ? chars[x] : " ";
      if (!QR_GLYPH.has(c)) return "";
      out.push(c);
    }
    out.push("\n");
  }
  return out.join("");
}

// ---- 主入口 ----
async function main() {
  // --stop 与登录态无关（清理残留 serve），必须放在 token 检查之前
  if (mode === "stop") doStop();

  // 已有 token（两阶段都先判）
  if (existsSync(AUTH_FILE)) {
    let rawClean = false;
    try {
      const raw = readFileSync(AUTH_FILE, "utf8").replace(/^\uFEFF/, "");
      rawClean = /^access_token\s*=/.test(raw);
      if (!rawClean) throw new Error("bad auth file");
    } catch (e) {
      log(`auth.toml 存在但无效（${e && e.message}），重新登录。`);
    }
    if (rawClean) {
      console.log("#oauth=ready");
      process.exit(0);
    }
  }

  const bin = findBinary();
  if (!bin) {
    console.log("#oauth=absent");
    console.error("gitcode-oauth 二进制缺失且自动安装失败（网络/架构不支持）。请手动从其官方仓库安装后重试。");
    process.exit(1);
  }

  if (mode === "wait") {
    await doWait(waitSession);
  } else if (mode === "login") {
    await doLogin(bin);
  } else {
    await doStart(bin);
  }
}

main().catch((e) => {
  // 异常也**不杀 serve**（用户可能刚好授权成功，保留才能用 --wait 收尾）
  console.log(`#oauth=failed reason=exception`);
  console.error(`异常: ${e && e.message}\n   后台 serve 保留（pid=${pidFilePid() || "?"}）：可重跑 --wait <session_id> 续上；放弃时跑 --stop 清理。`);
  process.exit(1);
});