#!/usr/bin/env node
// sync-src: huawei-cloud-publish-work-to-gallery/scripts/gitcode-repos.mjs（逻辑改动须同步两端；唯一差异=本行）
// gitcode-repos.mjs — GitCode 仓库清单 / 建仓（发布/提交流程「推已有仓库 or 新建仓库」的数据源；母技能 Step 3 / ICT 技能 Step 2.4）
//
// 背景:
//   发布/提交作品要求 workDir 有可访问的 GitCode 远端（gitUrl 必填）。workDir 不是 git 仓库 / 无 origin 时，
//   旧流程只把问题丢回用户（"你自己建仓并推送"），agent 既拿不到仓库清单也不能代建。本脚本补齐这两步：
//     --list    列出授权用户已有仓库（编号 + clone URL），供 agent 展示给用户挑选
//     --create  经用户同意后创建**空**仓库（auto_init=false，首次 push 即成为默认分支），返回 clone URL
//   拿到 clone URL 后由 agent 完成 `git init`/`git remote add`/`git push`（见 SKILL.md）。
//
// 鉴权（**不调用 gitcode-oauth CLI**：旧版 CLI 只有授权能力，没有 `get` 这种 API 透传子命令，
//   依赖它会直接失败）——本脚本自己带 Bearer token 调 GitCode OpenAPI，token 来源按序：
//     ① $GITCODE_TOKEN（PAT，无 OAuth 环境兜底）
//     ② ${GITCODE_HOME:-~/.gitcode}/auth.toml 的 access_token（gitcode-oauth 登录闭环落盘）
//   API base: $GITCODE_API_URL，默认 https://api.gitcode.com/api/v5
//   token 失效/过期（401/403）本脚本**不自行刷新**：重跑登录闭环
//   （gitcode-oauth.ensure.mjs --start / --wait，兼容旧版 CLI）后重试，或改用 $GITCODE_TOKEN。
//   脚本不打印 token，也不把 token 写进 URL / 文件 / 日志。
//
// 接口（GitCode OpenAPI v5，按官方文档核对）:
//   GET  /user/repos    列出授权用户所有仓库（visibility / q / sort / direction / per_page / repo_type）
//   POST /user/repos    创建个人项目仓库（name 必填；private 布尔；auto_init 默认 false）
//
// 用法、输出契约、退出码详见 node gitcode-repos.mjs --help。

import http from "node:http";
import https from "node:https";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

if (process.platform === "win32") {
  process.stdout.setDefaultEncoding?.("utf8");
  process.stderr.setDefaultEncoding?.("utf8");
}

const MAX_LIMIT = 100;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const TIMEOUT_MS = 10000;
const API_BASE = (process.env.GITCODE_API_URL || "https://api.gitcode.com/api/v5").replace(/\/+$/, "");
const AUTH_FILE = path.join(process.env.GITCODE_HOME || path.join(homedir(), ".gitcode"), "auth.toml");

const HELP = `gitcode-repos.mjs — GitCode 仓库清单 / 建仓（发布/提交流程的「推已有仓库 or 新建仓库」数据源）

用法:
  node gitcode-repos.mjs --list [--query <关键字>] [--limit 30] [--visibility public|private|all]
  node gitcode-repos.mjs --create <仓库名> [--path <仓库路径>] [--description <描述>] [--private]
  node gitcode-repos.mjs -h | --help

参数:
  --list               列出授权用户已有仓库（按更新时间倒序，含本人/组织/协作仓库）
  --create <name>      创建**空**仓库（auto_init=false，首次 push 即默认分支）；默认公开
  --query <kw>         列表关键字过滤（仓库名/描述）
  --limit <n>          列表条数 1~100，默认 30
  --visibility <v>     列表可见性 public | private | all，默认 all
  --path <p>           仓库路径，默认与仓库名相同
  --description <d>    仓库描述
  --private            建**私有**仓库（默认公开）。私有仓库平台/评审侧可能无法访问，仅在用户明确要求时使用

输出（成功信号，stdout）:
  --list:   #repo <n> <full_name> <cloneUrl> private=<0|1>    每行一个；末行 #count=<n>
  --create: #created full_name=<owner/name> cloneUrl=<https://… .git> webUrl=<https://…> private=<0|1>

鉴权（不依赖 gitcode-oauth CLI 的 get 子命令——旧版 CLI 只有授权能力）:
  token 来源（按序）: $GITCODE_TOKEN（PAT）→ ${AUTH_FILE} 的 access_token
  接口基址:           $GITCODE_API_URL（默认 https://api.gitcode.com/api/v5），请求超时 ${TIMEOUT_MS}ms
  未登录 / 401 / 403 → 先跑登录闭环再重试:
    node gitcode-oauth.ensure.mjs --start   # 拿 login_url 给用户（二维码 best-effort）
    node gitcode-oauth.ensure.mjs --wait <session_id>

退出码: 0=成功; 1=未登录/API 失败; 2=参数错误`;

function fail(msg, code = 1) {
  console.error(`❌ gitcode-repos: ${msg}`);
  process.exit(code);
}

// ---- 参数 ----
const argv = process.argv.slice(2);
let mode = "";
let query = "";
let limit = 30;
let visibility = "all";
let repoName = "";
let repoPath = "";
let description = "";
let isPrivate = false;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") { console.log(HELP); process.exit(0); }
  else if (a === "--list") mode = "list";
  else if (a === "--create") { mode = "create"; repoName = argv[++i] ?? ""; }
  else if (a === "--query") query = argv[++i] ?? "";
  else if (a === "--limit") limit = Number(argv[++i]);
  else if (a === "--visibility") visibility = argv[++i] ?? "";
  else if (a === "--path") repoPath = argv[++i] ?? "";
  else if (a === "--description") description = argv[++i] ?? "";
  else if (a === "--private") isPrivate = true;
  else fail(`未知参数: ${a}（运行 node gitcode-repos.mjs --help）`, 2);
}

if (mode === "list") {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) fail(`--limit 必须是 1~${MAX_LIMIT} 的整数`, 2);
  if (!["public", "private", "all"].includes(visibility)) fail("--visibility 只能是 public | private | all", 2);
} else if (mode === "create") {
  if (!repoName) fail("--create 需要仓库名（用户在「新建仓库」分支给出的名字）", 2);
  if (!NAME_RE.test(repoName)) fail(`仓库名不合法: ${repoName}（字母/数字开头，可含 . _ -，≤100 字符；GitCode 仓库路径不支持中文）`, 2);
  if (repoPath && !NAME_RE.test(repoPath)) fail(`--path 不合法: ${repoPath}（规则同仓库名）`, 2);
} else {
  fail("必须指定 --list 或 --create <仓库名>（运行 node gitcode-repos.mjs --help）", 2);
}

// ---- token（判据与 ensure-gitcode-credential.mjs / gitcode-oauth.ensure.mjs 同源：剥 BOM 后取 access_token）----
function readToken() {
  const envTok = (process.env.GITCODE_TOKEN || "").trim();
  if (envTok) return { token: envTok, source: "env-GITCODE_TOKEN" };
  if (!existsSync(AUTH_FILE)) return { token: "", source: "" };
  let raw = "";
  try {
    raw = readFileSync(AUTH_FILE, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return { token: "", source: "" };
  }
  const m = raw.match(/^\s*access_token\s*=\s*"?([^"\r\n]+)"?\s*$/m);
  if (!m) return { token: "", source: "" };
  return {
    token: m[1].trim(),
    source: "gitcode-auth-toml",
    expiresIn: Number((raw.match(/^\s*expires_in\s*=\s*(\d+)/m) || [])[1] || 0),
    createdAt: Number((raw.match(/^\s*created_at\s*=\s*(\d+)/m) || [])[1] || 0),
  };
}

const auth = readToken();
if (!auth.token) {
  fail(`未登录 GitCode（$GITCODE_TOKEN 未设置，且 ${AUTH_FILE} 无有效 access_token）。先完成两阶段 OAuth：
  ① node $SKILL_DIR/scripts/gitcode-oauth.ensure.mjs --start      # 拿 login_url 给用户（二维码 best-effort）
  ② node $SKILL_DIR/scripts/gitcode-oauth.ensure.mjs --wait <session_id>
完成后重跑本命令（也可用 GITCODE_TOKEN 直接传 PAT）。`);
}
if (auth.expiresIn > 0 && auth.createdAt > 0 && Date.now() / 1000 > auth.createdAt + auth.expiresIn - 60) {
  console.error(`⚠️ auth.toml 记录的 token 已过有效期（created_at + expires_in）；若本次返回 401/403，请重跑 gitcode-oauth.ensure.mjs --start / --wait。`);
}

// ---- GitCode OpenAPI v5（Bearer token；token 不进 URL/日志）----
function apiRequest(method, apiPath, bodyObj) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(API_BASE + apiPath);
    } catch {
      resolve({ ok: false, status: 0, message: `GITCODE_API_URL 不是合法 URL: ${API_BASE}` });
      return;
    }
    const isHttps = u.protocol === "https:";
    const mod = isHttps ? https : http;
    const payload = bodyObj ? JSON.stringify(bodyObj) : "";
    const headers = {
      Authorization: `Bearer ${auth.token}`,
      Accept: "application/json",
      "User-Agent": "gitcode-repos.mjs (huawei-cloud publish skills)",
    };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(text); } catch { /* 非 JSON：由调用方按状态码判定 */ }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text, json });
        });
      }
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`请求超时（${TIMEOUT_MS}ms）`)));
    req.on("error", (e) => resolve({ ok: false, status: 0, message: `请求失败: ${e?.message || e}` }));
    if (payload) req.write(payload);
    req.end();
  });
}

function apiMessage(res) {
  const m = res.json?.message || res.json?.error || (res.text || "").trim().slice(0, 200);
  return `HTTP ${res.status || "无响应"}${m ? `: ${m}` : ""}`;
}

// 401/403 统一处置：脚本不自行刷新 token（刷新/重登由登录闭环负责，兼容旧版 CLI）
function authHint(res) {
  return `登录态无效或已过期（${apiMessage(res)}）→ 重跑 gitcode-oauth.ensure.mjs --start / --wait 后重试，或用 GITCODE_TOKEN 传 PAT`;
}

function fullNameOf(obj, fallbackName) {
  if (obj?.full_name) return obj.full_name;
  const ns = obj?.namespace?.full_name || obj?.namespace?.path || obj?.namespace?.name || "?";
  return `${ns}/${obj?.path || obj?.name || fallbackName}`;
}

// clone URL 硬约束与 read-git-info.mjs 一致：https:// 开头、.git 结尾、不含内嵌凭证
function normalizeCloneUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return "";
  u = u.replace(/^https?:\/\//i, "https://").replace(/\/\/[^/@]*@/, "//");
  if (!/^https:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, "")}`;
  if (!/\.git$/i.test(u)) u = `${u.replace(/\/+$/, "")}.git`;
  return u;
}

function parseItems(text, json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.items)) return json.items;
  if (json === null && !text) return [];
  return null;
}

// ---- --list ----
if (mode === "list") {
  const qs = new URLSearchParams({
    per_page: String(limit),
    page: "1",
    sort: "updated",
    direction: "desc",
    visibility,
    repo_type: "code",
  });
  if (query) qs.set("q", query);

  const res = await apiRequest("GET", `/user/repos?${qs.toString()}`);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) fail(`列出仓库失败：${authHint(res)}`);
    if (res.status === 404) fail(`列出仓库失败（HTTP 404）：接口不存在——检查 GITCODE_API_URL（当前 ${API_BASE}）是否指向 OpenAPI v5。`);
    if (res.status === 429) fail(`列出仓库失败（HTTP 429）：触发频率限制，稍后重试。`);
    fail(`列出仓库失败：${res.status ? apiMessage(res) : res.message}`);
  }

  const items = parseItems(res.text, res.json);
  if (!items) fail(`仓库列表响应不是 JSON 数组（接口可能变更）。原始响应: ${res.text.slice(0, 200)}`);

  const rows = items.slice(0, limit);
  rows.forEach((it, i) => {
    const full = fullNameOf(it, "");
    const clone = normalizeCloneUrl(it.http_url_to_repo || it.web_url || it.html_url || `https://gitcode.com/${full}.git`);
    console.log(`#repo ${i + 1} ${full} ${clone} private=${Number(it.private) === 1 ? 1 : 0}`);
  });
  console.log(`#count=${rows.length}`);
  if (rows.length === 0) {
    const scope = query ? `--query ${query} 无命中` : "该账号暂无仓库";
    console.error(`提示：${scope} → 只能走「新建仓库」分支：node $SKILL_DIR/scripts/gitcode-repos.mjs --create <仓库名>。`);
  }
  process.exit(0);
}

// ---- --create ----
const payload = { name: repoName, path: repoPath || repoName, private: isPrivate, auto_init: false, repository_type: "code" };
if (description) payload.description = description;

const res = await apiRequest("POST", "/user/repos", payload);
if (!res.ok) {
  if (res.status === 409) {
    fail(`建仓失败：仓库名/路径已被占用（API 409）。\n` +
      `   处置：先 \`node $SKILL_DIR/scripts/gitcode-repos.mjs --list --query ${repoName}\` 看命中的是否就是用户已有仓库 → 请用户选择「改用已有仓库」或换一个仓库名后重试。`);
  }
  if (res.status === 401 || res.status === 403) fail(`建仓失败：${authHint(res)}`);
  if (res.status === 422) fail(`建仓失败：参数不被接受（HTTP 422，仓库名/路径/可见性）。改用字母数字与 . _ - 的仓库名后重试。\n   原始响应: ${apiMessage(res)}`);
  if (res.status === 429) fail(`建仓失败：触发频率限制（HTTP 429），稍后重试。`);
  fail(`建仓失败：${res.status ? apiMessage(res) : res.message}`);
}

if (res.json === null) fail(`建仓响应不是 JSON（接口可能变更）。原始响应: ${res.text.slice(0, 200)}`);
const full = fullNameOf(res.json, repoName);
const clone = normalizeCloneUrl(res.json.http_url_to_repo || `https://gitcode.com/${full}.git`);
const web = String(res.json.web_url || res.json.html_url || `https://gitcode.com/${full}`).replace(/^http:/i, "https:");
console.log(`#created full_name=${full} cloneUrl=${clone} webUrl=${web} private=${Number(res.json.private) === 1 || isPrivate ? 1 : 0}`);
