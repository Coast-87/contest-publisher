#!/usr/bin/env node
// list-problems.mjs — 查询 ICT 大赛全部 AI 赛题（调 A0 GET /open-api-public/v1/gallery/competition/camps）
// 经副本 api.mjs 发起 REST，解析 data.items 投影为可选行；供 agent 向用户展示赛题列表并选择 problemId。
// v2026-09-30 目标锁定：
//   * 新增 --select <n> / --select-name <kw>：按序号/名称关键词输出结构化目标行（#selected），
//     并写目标锁 .ict-target.json——选定后为本次运行唯一目标，禁止改投（锁指向他题须 --force）。
//     锁带 createdAt，超过 STS 凭证有效期（900s）自动作废 → 新提交无需 --force。
//   * agent 禁止从 #problem 文本行手抄/目测 ID，一律经 #selected 结构化行读取（根治行级混淆）。
//
// 用法:
//   node list-problems.mjs [--brief] [--api <api.mjs>] [--creds-file <json>] [--header "Name: v"]
//   node list-problems.mjs --select <n>   [--force] [--lock-file <f>] [同上选项]
//   node list-problems.mjs --select-name <kw> [--force] [--lock-file <f>] [同上选项]
//
// 成功 exit 0，stdout:
//   #status=<code>
//   #window(default)=<start>~<end> status=<s>         （仅 --brief 且多数赛题窗口相同时出现）
//   #problem <n> <name> [window=<start>~<end> status=<s>] [不可提交：作品发布任务题，禁止选择]
//                                                    （列表模式，仅序号+名称+窗口，不含 ID；赛题1（作品发布任务题）
//                                                     can_publish=false 仍展示但带不可提交标注，选择被拒）
//   --brief：同一活动下多数赛题的 window/status 完全相同（实测 19/20 行重复），折成一行
//            `#window(default)=…`，逐行只在偏离该默认值时补 window 后缀；不加 --brief 时逐字保持历史输出。
//   #selected number=<n> problemId=<pid> trainingCampId=<camp> name=<name>   （选择模式，name 为末字段；ID 仅此出）
//   空列表/全部不可提交 exit 1: `#none`（stderr 含明确原因）
//   请求失败 exit 1: 原样输出 api.mjs 响应（首行 #status）
// 选择模式失败 exit 2:
//   #selected-none reason=outofrange|nomatch
//   #selected-ambiguous matches=<m>   随后 1) number=… name=…
//   #selected-locked number=… problemId=… name=…   （锁指向他题，须 --force，改投须用户确认）
//   #selected-forbidden number=… problemId=… name=…  （can_publish=false，作品发布任务题，禁止选择）
// 参数错误 exit 2。

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  process.stdout.setDefaultEncoding?.("utf8");
  process.stderr.setDefaultEncoding?.("utf8");
}

const thisDir = path.dirname(fileURLToPath(import.meta.url));
function printHelp() {
  console.log(`list-problems.mjs — 查询 ICT 大赛全部 AI 赛题（A0 /competition/camps），支持目标选择与锁定

用法:
  node list-problems.mjs [--brief] [--api <api.mjs>] [--creds-file <json>] [--header "Name: v"]
  node list-problems.mjs --select <n> [--force] [--lock-file <f>] [...同上]
  node list-problems.mjs --select-name <kw> [--force] [--lock-file <f>] [...同上]

选项:
  --api <f>            api.mjs 路径（默认同目录副本）
  --creds-file <json>  STS 凭证文件，透传 api.mjs（open-api-public 前缀需要）
  --header "N: v"      额外请求头（如 X-Domain-Id），可叠加
  --brief              列表模式压缩：多数赛题窗口/状态相同时折成一行 #window(default)=…，
                       逐行只在偏离默认时补后缀（省 token；默认关闭，输出与历史逐字一致）
  --select <n>         按列表序号选择目标赛题，输出 #selected 并写目标锁（>=1）
  --select-name <kw>   按名称关键词选择（唯一匹配时同 --select；多条 → #selected-ambiguous）
  --lock-file <f>      目标锁路径（默认 --creds-file 同目录 .ict-target.json，无 creds 时 ./）
  --force              目标锁已指向其他赛题时覆盖（改投须用户明确同意）

目标锁: 选定后本次运行唯一目标；build-submit-params.mjs 会校验一致，禁止静默改投。

stdout: #status=<code> 开头；列表模式随后每行 #problem <n> <name> [window=… status=…]（不含 ID，
        ID 一律经 --select 的 #selected 行取得）
退出码: 0=成功; 1=无赛题或请求失败; 2=参数错误或选择失败`);
}

const argv = process.argv.slice(2);
const cli = { api: path.join(thisDir, "api.mjs"), headers: [], creds: null, select: null, selectName: null, lockFile: null, force: false, brief: false };
const expect = (i, name) => {
  const v = argv[i + 1];
  if (v === undefined) { console.error(`❌ ${name} 需要参数`); process.exit(2); }
  return v;
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") { printHelp(); process.exit(0); }
  else if (a === "--api") cli.api = expect(i, "--api"), i++;
  else if (a === "--creds-file") cli.creds = expect(i, "--creds-file"), i++;
  else if (a === "--header") cli.headers.push(expect(i, "--header")), i++;
  else if (a === "--select") { cli.select = Number(expect(i, "--select")); if (!Number.isInteger(cli.select) || cli.select < 1) { console.error("❌ --select 须为 >=1 的整数序号"); process.exit(2); } i++; }
  else if (a === "--select-name") { cli.selectName = expect(i, "--select-name"); i++; }
  else if (a === "--lock-file") { cli.lockFile = expect(i, "--lock-file"); i++; }
  else if (a === "--force") cli.force = true;
  else if (a === "--brief") cli.brief = true;
  else { console.error(`❌ 未知参数: ${a}`); process.exit(2); }
}
if (cli.select != null && cli.selectName != null) {
  console.error("❌ --select 与 --select-name 互斥，只能二选一");
  process.exit(2);
}

// ---- 目标锁（.ict-target.json）----
// 锁带 createdAt；超过 LOCK_STALE_MS（对齐 STS 凭证有效期 900s）视为过期，
// 过期锁自动作废 → 新目标无需 --force（仅保护同一次凭证存续期内的静默改投）。
const LOCK_STALE_MS = 900_000;
function defaultLockFile() {
  if (cli.creds) return path.join(path.dirname(path.resolve(cli.creds)), ".ict-target.json");
  return path.join(process.cwd(), ".ict-target.json");
}
function readLock(p) {
  try {
    const raw = readFileSync(p, "utf8");
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    return null;
  }
}
function lockIsStale(lock) {
  if (!lock?.createdAt || typeof lock.createdAt !== "string") return false; // 旧格式无时间戳 → 视为有效，兼容历史
  const t = Date.parse(lock.createdAt);
  return Number.isFinite(t) && Date.now() - t > LOCK_STALE_MS;
}
function writeLock(p, obj) {
  const data = { ...obj, createdAt: new Date().toISOString() };
  try {
    writeFileSync(p, JSON.stringify(data), "utf8");
  } catch (e) {
    console.error(`❌ 写目标锁失败: ${p}（${e instanceof Error ? e.message : e}）`);
    process.exit(1);
  }
}

// ---- 拉取 + 去重编号 ----
// --auto-refresh：含 _refresh 元数据时 401 自动刷新 STS 凭证并重试一次（对齐 submit-ict-work.mjs，
// 覆盖「等待用户选择赛题期间超过 900s 凭证有效期」的场景，过期不再裸 401）。
const baseArgs = [cli.api, "GET", "/v1/gallery/competition/camps"];
if (cli.creds) baseArgs.push("--creds-file", cli.creds, "--auto-refresh");
for (const h of cli.headers) baseArgs.push("--header", h);

let raw;
try {
  raw = execFileSync(process.execPath, baseArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  const out = (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
  process.stdout.write(out || "调用 api.mjs 失败\n");
  process.exit(1);
}

const nlIdx = raw.indexOf("\n");
const statusLine = nlIdx >= 0 ? raw.slice(0, nlIdx) : raw;
const body = nlIdx >= 0 ? raw.slice(nlIdx + 1) : "";

let resp;
try {
  resp = JSON.parse(body);
} catch {
  process.stdout.write(raw);
  process.exit(1);
}
if (!statusLine.includes("200") || !Array.isArray(resp?.data?.items)) {
  process.stdout.write(raw);
  process.exit(1);
}
const items = resp.data.items;
if (items.length === 0) {
  console.log("#status=200");
  console.log("#none");
  console.error("当前没有任何可提交的 ICT 大赛 AI 赛题。");
  process.exit(1);
}

// 与列表展示一致的去重编号（select 的 number 必须等于列表行首序号）
const problems = [];
const seen = new Set();
for (const it of items) {
  const pid = it.problemId ?? "";
  if (seen.has(pid)) continue;
  seen.add(pid);
  // can_publish=false（赛题1 作品发布任务题）：列表仍展示（供识别），但选择/提交均禁止
  problems.push({ number: problems.length + 1, pid, trainingCampId: it.trainingCampId ?? "", name: it.name ?? "", start: it.startsAt ?? "", end: it.endsAt ?? "", status: it.status ?? "", canPublish: it.can_publish !== false });
}

function winSuffix(p) {
  return p.start || p.end ? ` window=${p.start || "?"}~${p.end || "?"} status=${p.status || "?"}` : "";
}
function selectedLine(p) {
  return `#selected number=${p.number} problemId=${p.pid} trainingCampId=${p.trainingCampId} name=${p.name}`;
}

// ---- 选择模式：选目标 + 写目标锁 ----
function selectTarget(target) {
  const lockPath = cli.lockFile ?? defaultLockFile();
  const lock = readLock(lockPath);
  const stale = lockIsStale(lock);
  if (lock?.problemId && !stale && lock.problemId !== target.pid && !cli.force) {
    console.log(`#selected-locked number=${lock.number ?? "?"} problemId=${lock.problemId} name=${lock.name ?? ""}`);
    console.error(`❌ 目标已锁定为赛题 ${lock.number ?? "?"}「${lock.name ?? ""}」(${lock.problemId})。`);
    console.error(`   禁止改投其他赛题。如用户确需改投：回 Step 1 重新选择并经用户确认后加 --force。`);
    process.exit(2);
  }
  writeLock(lockPath, { number: target.number, problemId: target.pid, trainingCampId: target.trainingCampId, name: target.name });
  if (cli.force && lock?.problemId && !stale && lock.problemId !== target.pid) {
    console.error(`⚠️ 目标已切换：赛题 ${lock.number ?? "?"} → ${target.number}「${target.name}」`);
  }
  console.log(selectedLine(target));
  process.exit(0);
}

console.log(statusLine);
if (cli.select != null) {
  const target = problems.find((p) => p.number === cli.select);
  if (!target) {
    console.log(`#selected-none reason=outofrange range=1..${problems.length}`);
    console.error(`❌ 序号 ${cli.select} 超出范围（可选 1..${problems.length}）。`);
    process.exit(2);
  }
  if (!target.canPublish) {
    console.log(`#selected-forbidden number=${target.number} problemId=${target.pid} name=${target.name}`);
    console.error(`❌ 赛题 ${target.number}「${target.name}」为作品发布任务题（赛题1），不可提交，禁止选择。`);
    console.error(`   赛题1 需在做题面板领取任务后按要求完成（发布普通作品即完成）；请选择其他 AI 赛题。`);
    process.exit(2);
  }
  selectTarget(target);
}
if (cli.selectName != null) {
  const kw = cli.selectName.trim().toLowerCase();
  const matches = problems.filter((p) => p.name.toLowerCase().includes(kw));
  if (matches.length === 0) {
    console.log("#selected-none reason=nomatch");
    console.error(`❌ 无赛题名称包含「${cli.selectName}」。`);
    process.exit(2);
  }
  if (matches.length > 1) {
    console.log(`#selected-ambiguous matches=${matches.length}`);
    for (const p of matches) console.log(`${p.number}) number=${p.number} name=${p.name}`);
    console.error(`❌ 名称「${cli.selectName}」匹配 ${matches.length} 道赛题，请用序号精细化选择。`);
    process.exit(2);
  }
  if (!matches[0].canPublish) {
    console.log(`#selected-forbidden number=${matches[0].number} problemId=${matches[0].pid} name=${matches[0].name}`);
    console.error(`❌ 赛题「${matches[0].name}」为作品发布任务题（赛题1），不可提交，禁止选择。`);
    console.error(`   赛题1 需在做题面板领取任务后按要求完成（发布普通作品即完成）；请选择其他 AI 赛题。`);
    process.exit(2);
  }
  selectTarget(matches[0]);
}

// ---- 列表模式（仅移除行内 ID——ID 只能经 #selected 取得）----
// --brief：同一活动下多数赛题的 window/status 完全相同（实测 20 行里 19 行重复同一串），
// 折成一行 `#window(default)=…`，逐行只在偏离默认值时补后缀——信息不减，字符大减。
function briefDefault(ps) {
  const counts = new Map();
  for (const p of ps) {
    const k = winSuffix(p).trim();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return bestN > 1 ? best : ""; // 各题窗口互异（无重复）→ 不压缩，免得白打一行 default
}
const winDefault = cli.brief ? briefDefault(problems) : "";
if (winDefault) console.log(`#window(default)=${winDefault.replace(/^window=/, "")}`);
for (const p of problems) {
  const suffix = cli.brief && winSuffix(p).trim() === winDefault ? "" : winSuffix(p);
  console.log(`#problem ${p.number} ${p.name}${suffix}${p.canPublish ? "" : " [不可提交：作品发布任务题，禁止选择]"}`);
}
const selectable = problems.filter((p) => p.canPublish);
if (selectable.length === 0) {
  // 与脚本头/SKILL.md 契约一致：空列表与「全部不可提交」都在 stdout 打 `#none`（均由 exit 1 表示失败）
  console.log("#none");
  console.error("无可用赛题：赛题1 为作品发布任务题（不可提交），请先在做题面板领取赛题1任务，或等待 AI 赛题发布。");
  process.exit(1);
}
console.error(`共 ${problems.length} 道赛题（${selectable.length} 道可提交）。`);
process.exit(0);