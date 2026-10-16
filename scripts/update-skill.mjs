#!/usr/bin/env node
// update-skill.mjs — 把 huawei-cloud-publish-ict-work 技能升到上游最新版，并保持本地私有改动。
//
// 为什么需要这个脚本：技能是 vendored 副本（工作区一份权威副本 + 仓库一份内置快照，构建时打进 .app），
// 平台按登记版本卡 outdated 闸门（check-version.mjs exit 1 会拦住整个提交流程）；而本地相对上游有
// 私有改动（见 skill-overlays/manifest.json 的 why 一栏）——直接覆盖上游会静默丢掉它们。
// 所以升级 = 取上游整棵树 → 逐条重放本地差异 → 断言差异确实还在 → 校验 → 原子替换 → 镜像 → 重建。
//
// 安全边界：所有改动先在临时目录里做，任何一步失败都不会碰现有技能目录；替换前先备份。
// 网络不可达按 skip 处理（与 check-version.mjs 同一哲学：不阻塞，但要显式说明）。
//
// 用法:
//   node scripts/update-skill.mjs                      # 只检查（默认，不改任何文件）
//   node scripts/update-skill.mjs --apply              # 有新版本就升级并镜像
//   node scripts/update-skill.mjs --apply --rebuild    # 升级后重建 .app
//   node scripts/update-skill.mjs --status             # 打印本地/上游/平台三方版本
//   node scripts/update-skill.mjs --install-schedule   # 安装定期任务（默认每天 09:30）
//   node scripts/update-skill.mjs --uninstall-schedule
// 选项: --force（版本相同也重放补丁，用于修复被手改坏的树） --json --skill-dir <path>
//       --schedule daily|weekly --schedule-time HH:MM
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OVERLAY_DIR = path.join(ROOT, 'skill-overlays');
const PLIST_LABEL = 'com.contest-publisher.skill-update';
const LOG_PATH = path.join(os.homedir(), 'Library', 'Logs', 'contest-publisher-skill-update.log');
const BACKUP_ROOT = path.join(os.homedir(), '.contest-publisher', 'skill-backups');

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const option = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const jsonMode = flag('json');
const log = [];
const say = message => { log.push(message); if (!jsonMode) process.stdout.write(`${message}\n`); };
function fail(message) {
  say(`❌ ${message}`);
  if (jsonMode) process.stdout.write(`${JSON.stringify({ ok: false, error: message, log }, null, 2)}\n`);
  process.exit(1);
}
function finish(payload) {
  if (jsonMode) process.stdout.write(`${JSON.stringify({ ok: true, log, ...payload }, null, 2)}\n`);
  process.exit(0);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: options.cwd, encoding: 'utf8', timeout: options.timeout ?? 600_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

// 版本号是 YYYY.MM.DD.NNN 四段；上游出现过三段（2026.10.15）且平台判它 outdated，
// 缺失段按 0 处理，非数字段退回字符串比较。
function compareVersions(a, b) {
  const A = String(a).trim().split('.');
  const B = String(b).trim().split('.');
  if (A.some(part => Number.isNaN(Number(part))) || B.some(part => Number.isNaN(Number(part)))) return A.join('.') === B.join('.') ? 0 : (A.join('.') > B.join('.') ? 1 : -1);
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) {
    const x = Number(A[i] ?? 0);
    const y = Number(B[i] ?? 0);
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function localVersion(skillDir) {
  const md = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const m = md.match(/^\s*version\s*:\s*(.+?)\s*$/m);
  return m ? m[1].trim() : '';
}

async function upstreamVersion(upstream) {
  const url = `https://gitcode.com/api/v5/repos/${upstream.apiPath}/contents/${upstream.skillPath}/SKILL.md?ref=${upstream.branch}`;
  const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error' });
  if (!response.ok) throw new Error(`上游版本查询失败 HTTP ${response.status}`);
  const data = await response.json();
  if (!data?.content) throw new Error('上游 SKILL.md 响应里没有 content');
  const text = Buffer.from(data.content, 'base64').toString('utf8');
  const m = text.match(/^\s*version\s*:\s*(.+?)\s*$/m);
  if (!m) throw new Error('上游 SKILL.md 里没有 version 字段');
  return m[1].trim();
}

// 平台登记的版本（不需要凭证，走 guest 前缀）。新版本落后于它时闸门会拦，所以要在输出里露出来。
async function platformStatus(manifest, skillDir) {
  try {
    const api = path.join(skillDir, 'scripts', 'api.mjs');
    const out = run(process.execPath, [api, 'GET', '/v1/gallery/skills/status', '--prefix', 'open-api-guest', '--query', `name=${manifest.skill.name}&version=${localVersion(skillDir)}`], { timeout: 20_000 });
    const line = out.split('\n').find(l => l.trim().startsWith('{'));
    return line ? JSON.parse(line)?.data ?? null : null;
  } catch {
    return null;
  }
}

function loadManifest() {
  const manifest = JSON.parse(readFileSync(path.join(OVERLAY_DIR, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error(`未知的 manifest schemaVersion: ${manifest.schemaVersion}`);
  return manifest;
}

function resolveSkillDir(manifest) {
  const override = option('skill-dir');
  const dir = override ? path.resolve(override) : path.resolve(ROOT, manifest.skill.local.path);
  if (!existsSync(path.join(dir, 'SKILL.md'))) throw new Error(`技能目录里没有 SKILL.md: ${dir}`);
  return dir;
}

// 浅克隆 + 稀疏检出：整个仓库很大，只取技能目录和 troubleshooting 的来源目录。
function downloadUpstream(stage, manifest, upstream) {
  const clone = path.join(stage, '.upstream');
  mkdirSync(clone, { recursive: true });
  run('git', ['clone', '--depth', '1', '--branch', upstream.branch, '--filter=blob:none', '--sparse', upstream.cloneUrl, clone], { timeout: 300_000 });
  const sources = [upstream.skillPath, ...manifest.overlays.filter(o => o.from).map(o => path.dirname(o.from))];
  run('git', ['-C', clone, 'sparse-checkout', 'set', ...new Set(sources)], { timeout: 300_000 });
  const tree = path.join(clone, upstream.skillPath);
  if (!existsSync(path.join(tree, 'SKILL.md'))) throw new Error('上游稀疏检出后找不到技能目录');
  const fetched = localVersion(tree);
  const copy = path.join(stage, 'skill');
  cpSync(tree, copy, { recursive: true });
  return { copy, clone, fetched };
}

function applyPatch(skillDir, patchFile) {
  const patchPath = path.join(OVERLAY_DIR, patchFile);
  if (!existsSync(patchPath)) throw new Error(`补丁不存在: ${patchPath}`);
  try {
    run('git', ['apply', '-p1', '--whitespace=nowarn', patchPath], { cwd: skillDir });
    return 'git apply';
  } catch (gitError) {
    // git 不可用或拒绝时退回 patch(1)：两者对同一 unified diff 的结果一致。
    try {
      run('patch', ['-p1', '-s', '-i', patchPath], { cwd: skillDir });
      return 'patch';
    } catch {
      throw new Error(`补丁未能在上游新版上应用（上游可能改动了同一处）: ${patchFile}\n${gitError.message.split('\n').slice(0, 6).join('\n')}`);
    }
  }
}

// 逐条重放本地私有改动，并立即断言改动确实落地——静默丢改动正是这个脚本要防的事故。
function applyOverlays(skillDir, manifest, clone) {
  const applied = [];
  for (const overlay of manifest.overlays) {
    const target = path.join(skillDir, overlay.path);
    let how;
    if (overlay.patch) {
      how = applyPatch(skillDir, overlay.patch);
    } else if (overlay.from) {
      const source = path.join(clone, overlay.from);
      if (!existsSync(source)) throw new Error(`来源文件不存在（上游可能挪了目录）: ${overlay.from}`);
      let text = readFileSync(source, 'utf8');
      for (const rewrite of overlay.rewrites ?? []) {
        if (!text.includes(rewrite.from)) throw new Error(`${overlay.path} 的改写目标未找到: ${rewrite.from}`);
        text = text.replaceAll(rewrite.from, rewrite.to);
      }
      writeFileSync(target, text);
      how = `copy ${overlay.from}`;
    } else {
      throw new Error(`overlay 既没有 patch 也没有 from: ${overlay.path}`);
    }
    const written = readFileSync(target, 'utf8');
    const missing = (overlay.mustContain ?? []).filter(token => !written.includes(token));
    if (missing.length) throw new Error(`${overlay.path} 重放后缺少本地特性: ${missing.join(' / ')}`);
    applied.push({ path: overlay.path, how });
  }
  return applied;
}

// 替换前把新树验一遍：脚本语法 + 版本闸门。闸门失败说明升上去也过不了提交前置，不如不换。
function verifyStage(skillDir) {
  const scriptsDir = path.join(skillDir, 'scripts');
  for (const name of readdirSync(scriptsDir).filter(f => f.endsWith('.mjs'))) {
    run(process.execPath, ['--check', path.join(scriptsDir, name)], { timeout: 30_000 });
  }
  const genSts = path.join(scriptsDir, 'gen_sts.py');
  if (existsSync(genSts)) {
    try { run('python3', ['-m', 'py_compile', genSts], { timeout: 30_000 }); }
    catch { say('⚠️ gen_sts.py 语法检查跳过（本机 python3 不可用）'); }
  }
  const gate = run(process.execPath, [path.join(scriptsDir, 'check-version.mjs')], { timeout: 30_000 }).trim();
  if (!/status=(ok|skip)/.test(gate)) throw new Error(`新副本未通过版本闸门: ${gate}`);
  return gate;
}

function swapIn(skillDir, stageSkill) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(BACKUP_ROOT, `${stamp}-${path.basename(skillDir)}`);
  mkdirSync(BACKUP_ROOT, { recursive: true });
  cpSync(skillDir, backup, { recursive: true });
  try {
    rmSync(skillDir, { recursive: true, force: true });
    cpSync(stageSkill, skillDir, { recursive: true });
  } catch (error) {
    rmSync(skillDir, { recursive: true, force: true });
    cpSync(backup, skillDir, { recursive: true });
    throw new Error(`替换失败，已回滚到升级前状态: ${error.message}`);
  }
  return backup;
}

function mirror(skillDir, manifest) {
  const done = [];
  for (const target of manifest.skill.mirrors) {
    const dest = path.resolve(ROOT, target.path);
    rmSync(dest, { recursive: true, force: true });
    cpSync(skillDir, dest, { recursive: true });
    done.push(dest);
  }
  return done;
}

function rebuild() {
  if (process.platform !== 'darwin') return 'skipped (非 macOS，Windows 包请用 build-win.sh)';
  run('npm', ['run', 'build'], { cwd: ROOT, timeout: 600_000 });
  run('./build-app.sh', [], { cwd: ROOT, timeout: 900_000 });
  return 'done';
}

function notify(title, message) {
  if (process.platform !== 'darwin') return;
  try {
    run('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`], { timeout: 10_000 });
  } catch { /* 通知失败不影响升级结果 */ }
}

function schedulePath() { return path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`); }

function installSchedule(manifest) {
  const cadence = option('schedule', 'daily');
  const [hour, minute] = (option('schedule-time', '09:30')).split(':').map(Number);
  const calendar = cadence === 'weekly' ? `<key>Weekday</key><integer>1</integer>` : '';
  // launchd 不读登录 shell 的 PATH：node/npm/bun/swiftc/python3 都得靠这里显式给（重建 .app 要用）。
  // 可执行文件用 /usr/bin/env node 而不是写死路径——本机 node 装在 pi-node 下，写死的话换版本就失效。
  const envPath = [...new Set([
    path.dirname(process.execPath),
    '/opt/homebrew/bin',
    path.join(os.homedir(), '.bun', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ])].join(':');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>${path.join(ROOT, 'scripts', 'update-skill.mjs')}</string>
    <string>--apply</string>
    <string>--rebuild</string>
    <string>--json</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    ${calendar}
    <key>Hour</key><integer>${Number.isFinite(hour) ? hour : 9}</integer>
    <key>Minute</key><integer>${Number.isFinite(minute) ? minute : 30}</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${envPath}</string></dict>
  <key>StandardOutPath</key><string>${LOG_PATH}</string>
  <key>StandardErrorPath</key><string>${LOG_PATH}</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
`;
  mkdirSync(path.dirname(schedulePath()), { recursive: true });
  mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  writeFileSync(schedulePath(), plist);
  const uid = process.getuid();
  try { run('launchctl', ['bootstrap', `gui/${uid}`, schedulePath()]); }
  catch { run('launchctl', ['load', '-w', schedulePath()]); }
  const when = cadence === 'weekly' ? `每周一 ${hour}:${String(minute).padStart(2, '0')}` : `每天 ${hour}:${String(minute).padStart(2, '0')}`;
  say(`✅ 已安装定期任务：${when} 自动检查并升级（日志 ${LOG_PATH}）`);
  say(`   移除：node scripts/update-skill.mjs --uninstall-schedule`);
  return { plist: schedulePath(), cadence, hour, minute };
}

function uninstallSchedule() {
  const uid = process.getuid();
  try { run('launchctl', ['bootout', `gui/${uid}/${PLIST_LABEL}`]); }
  catch { try { run('launchctl', ['unload', '-w', schedulePath()]); } catch { /* 本来就没加载 */ } }
  if (existsSync(schedulePath())) rmSync(schedulePath(), { force: true });
  say('✅ 已移除定期任务');
}

async function main() {
  const manifest = loadManifest();
  const skillDir = resolveSkillDir(manifest);
  const upstream = manifest.skill.upstream;

  if (flag('uninstall-schedule')) return finish({ status: 'schedule-removed' });
  if (flag('install-schedule')) return finish({ status: 'schedule-installed', schedule: installSchedule(manifest) });

  const local = localVersion(skillDir);
  let upstream_;
  try { upstream_ = await upstreamVersion(upstream); }
  catch (error) {
    // 网络不通不阻塞（与版本闸门一致），但要明确说出来，别让人以为"已是最新"。
    say(`⚠️ 无法查询上游版本：${error.message}`);
    return finish({ status: 'skip', local, upstream: null });
  }
  const platform = await platformStatus(manifest, skillDir);
  const cmp = compareVersions(local, upstream_);
  say(`本地 ${local} · 上游 ${upstream_} · 平台登记 ${platform?.version ?? '（未知）'}${platform ? `（${platform.status}）` : ''}`);

  if (flag('status')) return finish({ status: cmp < 0 ? 'update-available' : 'up-to-date', local, upstream: upstream_, platform });
  if (cmp >= 0 && !flag('force')) {
    const stale = platform?.version && compareVersions(local, platform.version) < 0;
    if (stale) say(`⚠️ 本地已是最新的上游版本，但平台登记的是 ${platform.version}——上游还没跟上平台，闸门仍会拦，等上游发布或联系赛题方。`);
    return finish({ status: stale ? 'platform-ahead' : 'up-to-date', local, upstream: upstream_, platform });
  }
  if (cmp < 0) say(`发现新版本：${local} → ${upstream_}`);
  else say('版本相同，--force 重放本地差异（修复被改坏的树）');

  const stageRoot = path.join(os.tmpdir(), `ict-skill-stage-${Date.now()}`);
  mkdirSync(stageRoot, { recursive: true });
  try {
    const { copy, clone, fetched } = downloadUpstream(stageRoot, manifest, upstream);
    if (!flag('force') && compareVersions(fetched, upstream_) < 0) fail(`上游克隆到的版本 ${fetched} 落后于接口报告的 ${upstream_}，请重试`);
    const applied = applyOverlays(copy, manifest, clone);
    for (const item of applied) say(`   ✓ 重放 ${item.path}（${item.how}）`);
    const gate = verifyStage(copy);
    say(`   ✓ 新副本通过校验（${gate}）`);

    if (!flag('apply')) {
      // 默认只检查：把试出来的结果丢掉，不碰现有目录。
      return finish({ status: 'update-available', local, upstream: upstream_, platform, applied, verify: gate });
    }

    const backup = swapIn(skillDir, copy);
    say(`✅ 已升级到 ${upstream_}（升级前副本备份在 ${backup}）`);
    const mirrored = mirror(skillDir, manifest);
    say(`✅ 已同步到 ${mirrored.length} 处内置副本`);
    let rebuilt = 'skipped';
    if (flag('rebuild')) {
      rebuilt = rebuild();
      say(`✅ .app 重建：${rebuilt}`);
    } else {
      say('ℹ️ 未重建 .app（加 --rebuild 可一并重建；不重建时应用内置副本仍是旧版）');
    }
    notify('ICT 技能已升级', `${local} → ${upstream_}`);
    return finish({ status: 'updated', from: local, to: upstream_, platform, backup, mirrored, rebuilt });
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

main().catch(error => fail(error.message));
