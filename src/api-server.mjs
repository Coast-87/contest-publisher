import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, mkdir, lstat, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolveScriptRuntime, run } from './process.mjs';
import { PLATFORM, gitInstallHint, knownGitPaths, knownHcloudPaths, openTarget, resolvePython, resolveSidecar, sidecarRoots, whichSync } from './platform.mjs';
import { acquireLocalSource, acquireSource, listLocalSources, repoNameFromLocal, repoNameFromUrl, validateSourceUrl } from './acquire.mjs';
import { auditRun } from './audit.mjs';
import { reviewFinding } from './review.mjs';
import { prepareRun, writeContributionRecord } from './prepare.mjs';
import { verifyPrepared } from './verify.mjs';
import { createOrReuseGitCodeRepo, createGitCodeRepo, setGitCodeRepoVisibility } from './gitcode.mjs';
import { initPreparedRepo, pushPreparedRepo } from './git.mjs';
import { fetchSubmissionStatus, listCompetitionProblems, selectCompetitionProblem } from './competition.mjs';
import { buildSubmitPlan, parseSubmitOutput } from './submit.mjs';
import { deleteRun, listRuns, readRunMode, statusRun, writeRunMode } from './state.mjs';
import { diffRun } from './diff.mjs';
import { scaffoldRun } from './scaffold.mjs';
import { defaultLocalSourcesDir, defaultRunsRoot, ensureDir, ensureLocalSourcesDir, exists, inside, readJson, readSettings, resolveRunsRoot, writeJson, writeSettings } from './store.mjs';
import { classifyPath, isKeptPath, normalizeKeepPaths, normalizeRelativePath } from './policy.mjs';

const MAX_BODY = 2 * 1024 * 1024;
// 一键推送是单个长请求，工作台靠轮询 /auto-push-progress 拿分步进度；按 runDir 保留最近一次。
const autoPushProgress = new Map();

function routePath(rawUrl) {
  const url = new URL(rawUrl ?? '/', 'http://127.0.0.1');
  return url.pathname.replace(/\/+$/, '') || '/';
}
function query(req, name) {
  return new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get(name);
}
function routeId(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  return pathname.slice(prefix.length).split('/').filter(Boolean);
}
// Run references arrive percent-encoded (the workbench encodes the whole id),
// so decode before deciding whether it is a bare id or an absolute directory.
function decodeRunRef(raw) {
  try { return decodeURIComponent(String(raw ?? '')).trim(); } catch { throw new Error('Invalid run id'); }
}
function assertRunId(id, root) {
  const decoded = decodeRunRef(id);
  const base = path.resolve(root);
  const runDir = path.isAbsolute(decoded) ? path.resolve(decoded) : path.resolve(base, decoded);
  if (!decoded || runDir === base || !inside(base, runDir) || path.basename(runDir) === '') throw new Error('Invalid run id');
  if (!path.isAbsolute(decoded) && !/^[0-9A-Za-z-]+$/.test(decoded)) throw new Error('Invalid run id');
  return runDir;
}
async function body(req) {
  let size = 0; let data = '';
  for await (const chunk of req) {
    size += chunk.length; if (size > MAX_BODY) throw new Error('Request body too large');
    data += chunk;
  }
  return data ? JSON.parse(data) : {};
}
function json(res, status, value) {
  const payload = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`${payload}\n`);
}
// 保留路径按 run 存在副本 manifest 里（prepare 时写入），编辑器与展示据此放行。
async function keptPathsOf(runDir) {
  try {
    const manifest = await readJson(path.join(runDir, 'work', '.contest-publisher-manifest.json'));
    return normalizeKeepPaths(manifest?.keepPaths ?? []);
  } catch { return []; }
}
// The workbench file picker renders `path · kind`, so return classified entries rather than
// bare paths: the editor accepts code files, kept artifact files, and CONTRIBUTIONS.md.
async function listWorkFiles(runDir) {
  const root = path.join(runDir, 'work');
  const keepPaths = await keptPathsOf(runDir);
  const out = [];
  async function walk(current, relative = '') {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && entry.name !== '.git') await walk(path.join(current, entry.name), rel);
      else if (entry.isFile()) out.push({ path: rel, kind: isKeptPath(rel, keepPaths) ? 'kept' : classifyPath(rel).kind });
    }
  }
  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
async function checkedWorkFile(runDir, relative, create) {
  const rel = normalizeRelativePath(relative);
  const work = path.join(runDir, 'work');
  const kind = classifyPath(rel).kind;
  const kept = isKeptPath(rel, await keptPathsOf(runDir));
  if (rel !== 'CONTRIBUTIONS.md' && !kept && !['code', 'docs'].includes(kind)) throw new Error('UI 编辑器只允许编辑源代码、项目文档、保留的产物文件和 CONTRIBUTIONS.md');
  const target = path.resolve(work, ...rel.split('/'));
  if (!inside(work, target) || target === work) throw new Error('文件路径越出工作副本');
  let current = work;
  for (const part of rel.split('/').slice(0, -1)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('不允许经过符号链接写文件'); }
    catch (error) { if (error.code === 'ENOENT' && create) await mkdir(current, { recursive: true }); else throw error; }
  }
  try { const stat = await lstat(target); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('目标必须是普通文件'); if (create) throw new Error('文件已存在'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; if (!create) throw error; }
  return target;
}
async function requireVerification(runDir, message, options = {}) {
  const result = await verifyPrepared(path.join(runDir, 'work'), { ...options, allowCopy: (await readRunMode(runDir)) === 'copy' });
  if (result.status !== 'passed') throw new Error(`${message}：${result.findings.filter(item => item.disposition === 'block').map(item => item.category).join(', ')}`);
  return result;
}

// The runs root is workspace state: the workbench may point it at another
// directory, and every route must resolve against the current value.
function toWorkspace(value) {
  if (typeof value === 'string') return { root: path.resolve(value), mutable: false };
  if (value && typeof value.root === 'string') return value;
  throw new Error('handleApiRequest requires a runs root');
}

async function switchRunsRoot(workspace, candidate) {
  const next = resolveRunsRoot(candidate);
  if (!next || next === workspace.root) return workspace.root;
  if (workspace.mutable === false) throw new Error(`运行根目录由服务端固定为 ${workspace.root}，如需更改请用 --runs-root 重启`);
  await ensureDir(next);
  workspace.root = next;
  await writeSettings({ ...(await readSettings(next)), runsRoot: next });
  return next;
}

export async function handleApiRequest(req, res, target) {
  const workspace = toWorkspace(target);
  let root = workspace.root;
  try {
      const pathname = routePath(req.url);
      if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, app: 'contest-publisher', platform: PLATFORM, packaged: sidecarRoots().length > 1 });
      if (req.method === 'GET' && pathname === '/api/runs-root') {
        return json(res, 200, { runsRoot: root, defaultRunsRoot: await defaultRunsRoot(), mutable: workspace.mutable !== false });
      }
      if (req.method === 'GET' && pathname.startsWith('/assets/')) {
        const assetName = pathname.replace('/assets/', '').replace(/[^a-zA-Z0-9._-]/g, '');
        // 打包态（mac .app / Windows 绿色包）assets 就在可执行文件旁边，开发态在项目根目录。
        let assetPath = null;
        for (const root of sidecarRoots()) {
          const candidate = path.join(root, 'assets', assetName);
          if (!inside(root, candidate)) return json(res, 403, { error: 'Forbidden' });
          if (existsSync(candidate)) { assetPath = candidate; break; }
        }
        if (!assetPath) return json(res, 404, { error: 'Not found' });
        try {
          const data = await readFile(assetPath);
          const ext = path.extname(assetName).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.svg' ? 'image/svg+xml' : ext === '.ico' ? 'image/x-icon' : 'application/octet-stream';
          res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=3600' });
          res.end(data);
          return;
        } catch { return json(res, 404, { error: 'Not found' }); }
      }
      if (req.method === 'GET' && pathname === '/api/runs') return json(res, 200, await listRuns(root));
      if (req.method === 'GET' && pathname.startsWith('/api/runs/')) {
        const parts = routeId(pathname, '/api/runs/'); const runDir = assertRunId(parts[0], root);
        if (parts[1] === 'audit') return json(res, 200, await readJson(path.join(runDir, 'evidence', 'audit.json')));
        if (parts[1] === 'work-files') return json(res, 200, await listWorkFiles(runDir));
        if (parts[1] === 'diff') {
          const file = query(req, 'path');
          const rawContext = query(req, 'context');
          const context = rawContext === null || rawContext === '' ? 3 : Number(rawContext);
          return json(res, 200, await diffRun(runDir, {
            path: file || undefined,
            includeHunks: query(req, 'hunks') !== '0',
            context: Number.isFinite(context) && context >= 0 ? context : 3,
          }));
        }
        if (parts[1] === 'auto-push-progress') {
          const record = autoPushProgress.get(runDir);
          return json(res, 200, record ?? { runDir, stage: 'idle', steps: [] });
        }
        // 只读赛题列表：工作台据此展示全部赛题并选择目标（选择经由 auto-push/submit 的 config.problemNumber）。
        if (parts[1] === 'problems') {
          const skillDir = query(req, 'skillDir') || BUNDLED_SKILL_DIR;
          return json(res, 200, await listCompetitionProblems({ skillDir, creds: query(req, 'creds') }));
        }
        if (parts[1] === 'file') { const relative = new URL(req.url, 'http://127.0.0.1').searchParams.get('path'); const file = await checkedWorkFile(runDir, relative, false); const content = await readFile(file, 'utf8'); return json(res, 200, { path: normalizeRelativePath(relative), content }); }
        return json(res, 200, await statusRun(runDir));
      }
      if (req.method === 'DELETE' && pathname.startsWith('/api/runs/')) {
        const parts = routeId(pathname, '/api/runs/');
        if (parts.length > 1) return json(res, 404, { error: 'Not found' });
        const runDir = assertRunId(parts[0], root);
        const force = query(req, 'force') === '1' || query(req, 'force') === 'true';
        return json(res, 200, await deleteRun(runDir, { force, root }));
      }
      // 一键清除：按与单条删除完全相同的护栏逐个删；含未推送工作副本的默认跳过，force 时才删。
      if (req.method === 'POST' && pathname === '/api/runs/clear') {
        const input = await body(req);
        const force = input.force === true;
        const runs = await listRuns(root);
        const deleted = [];
        const skipped = [];
        for (const run of runs) {
          try { await deleteRun(run.runDir, { force, root }); deleted.push(run.runId); }
          catch (error) { skipped.push({ runId: run.runId, reason: error instanceof Error ? error.message : String(error) }); }
        }
        return json(res, 200, { ok: true, deleted, skipped });
      }
      if (req.method === 'POST' && pathname === '/api/runs') {
        const input = await body(req);
        // 本地仓库模式：先校验条目存在再切换工作区（与 URL 校验同一条规矩），
        // 然后把代码包（文件夹/zip）做成只读快照——下游流程与 Git 源完全一致。
        if (input.localSource) {
          const sourcesDir = (await readSettings(root)).localSourcesDir;
          const listing = await listLocalSources(sourcesDir);
          if (!listing.entries.some(item => item.name === String(input.localSource).trim())) {
            throw new Error(`本地仓库里没有「${input.localSource}」：请把代码包放进 ${listing.dir} 后点「刷新列表」`);
          }
          root = await switchRunsRoot(workspace, input.runsRoot);
          const result = await acquireLocalSource({ entryName: input.localSource, sourcesDir, runsRoot: root });
          return json(res, 201, { ...result, runId: path.basename(result.runDir), runsRoot: root });
        }
        // Validate the clone URL before switching roots so a typo cannot move the workspace.
        const sourceUrl = validateSourceUrl(input.sourceUrl);
        root = await switchRunsRoot(workspace, input.runsRoot);
        const result = await acquireSource({ sourceUrl, ref: input.ref || 'main', runsRoot: root });
        return json(res, 201, { ...result, runId: path.basename(result.runDir), runsRoot: root });
      }
      // 本地仓库目录：列表 + 首次自动建目录（附说明文件，方便把软件直接给别人用）。
      if (req.method === 'GET' && pathname === '/api/local-sources') {
        return json(res, 200, await listLocalSources((await readSettings(root)).localSourcesDir));
      }
      if (req.method === 'POST' && pathname === '/api/local-sources/open') {
        const dir = await ensureLocalSourcesDir((await readSettings(root)).localSourcesDir);
        openTarget(dir, { kind: 'path' });
        return json(res, 200, { ok: true, dir });
      }
      if (req.method === 'POST' && pathname === '/api/open-path') {
        const input = await body(req); const target = path.resolve(input.path);
        openTarget(target, { kind: 'path' });
        return json(res, 200, { ok: true });
      }
      // 退出软件：Windows 绿色包是「双击 → 打开工作台窗口」的形态，没有窗口可关的场合
      // （例如只打开了默认浏览器）需要一个明确的退出入口。仅本机回环地址可达。
      if (req.method === 'POST' && pathname === '/api/quit') {
        if (typeof workspace.shutdown !== 'function') return json(res, 400, { error: '当前进程不支持退出' });
        json(res, 200, { ok: true });
        setTimeout(() => { try { workspace.shutdown(); } catch { /* 已经在退出了 */ } }, 150);
        return;
      }
      if (req.method === 'GET' && pathname === '/api/settings') {
        const saved = await readSettings(root);
        return json(res, 200, { ...saved, runsRoot: root, localSourcesDir: await defaultLocalSourcesDir() });
      }
      if (req.method === 'POST' && pathname === '/api/settings') {
        const input = await body(req);
        const saved = await readSettings(root);
        if (Object.hasOwn(input, 'runsRoot')) root = await switchRunsRoot(workspace, input.runsRoot);
        await mkdir(root, { recursive: true });
        await writeSettings({ ...saved, ...input, runsRoot: root });
        return json(res, 200, { ok: true, runsRoot: root });
      }
      if (req.method === 'GET' && pathname === '/api/env-check') {
        const checks = [];
        const add = (name, ok, detail, hint) => checks.push({ name, ok, detail, hint });
        // git
        const gitPath = knownGitPaths().find(p => { try { return existsSync(p); } catch { return false; } }) ?? whichSync('git');
        if (gitPath) {
          try { const v = run(gitPath, ['--version'], { timeout: 5000 }).trim(); add('git', true, v); }
          catch (e) { add('git', false, '无法执行', e.message); }
        } else add('git', false, '未安装', gitInstallHint());
        // hcloud (KooCLI) — preferred for STS generation
        let hcloudPath = process.env.HCLOUD_EXE;
        if (!hcloudPath || !existsSync(hcloudPath)) hcloudPath = knownHcloudPaths().find(p => existsSync(p));
        if (!hcloudPath) hcloudPath = whichSync('hcloud');
        if (hcloudPath && existsSync(hcloudPath)) add('hcloud', true, hcloudPath);
        else add('hcloud', false, '未找到 KooCLI', '可选：安装后可自动生成 STS，无需手动准备凭证文件。下载: https://developer.huaweicloud.com/develop/koocli.html');
        // python (STS 生成脚本依赖它)
        const python = resolvePython();
        try {
          const v = run(python, ['--version'], { timeout: 10_000 }).trim();
          add('python', true, `${v}（${python}）`);
        } catch (e) { add('python', false, `未找到可用的 python`, '仅「自动生成 STS」需要；也可直接填写已有的 STS 凭证文件路径'); }
        // node runtime (server itself) + which runtime ICT skill scripts will run on
        const scriptRuntime = resolveScriptRuntime();
        const bunFallback = Boolean(scriptRuntime.env.BUN_BE_BUN);
        add('node', true, bunFallback
          ? `主程序 ${process.version} · ICT 脚本将用内置 Bun 运行（未找到独立 node）`
          : `主程序 ${process.version} · ICT 脚本运行时 ${scriptRuntime.command}`,
        bunFallback ? '如需强制使用某个 node，设置环境变量 CONTEST_PUBLISHER_NODE 后重启' : undefined);
        // bundled skill
        if (BUNDLED_SKILL_DIR) add('skill', true, `内置 Skill 已就绪: ${BUNDLED_SKILL_DIR}`);
        else add('skill', false, '未找到内置 ICT Skill 目录', '请确认 huawei-cloud-publish-ict-work 与应用同目录或在项目根目录');
        // gitcode token (from settings saved client-side, checked on demand)
        add('gitcode-token', 'client', '由前端配置面板检查');
        // write permission for runs/
        try {
          const runsRoot = path.resolve(root);
          await mkdir(runsRoot, { recursive: true });
          const probe = path.join(runsRoot, '.perm-check');
          await writeFile(probe, 'ok'); await unlink(probe);
          add('runs-writable', true, runsRoot);
        } catch (e) { add('runs-writable', false, '无法写入 runs 目录', e.message); }
        // network reachability to gitcode (HEAD request, 3s timeout)
        try {
          const res = await fetch('https://gitcode.com', { method: 'HEAD', signal: AbortSignal.timeout(3000) });
          add('network-gitcode', res.status < 500, `HTTP ${res.status}`);
        } catch { add('network-gitcode', false, '无法访问 gitcode.com', '请检查网络或代理'); }
        // ICT API reachability
        try {
          const res = await fetch('https://gallery.developer.huaweicloud.com', { method: 'HEAD', signal: AbortSignal.timeout(3000) });
          add('network-ict', res.status < 500, `HTTP ${res.status}`);
        } catch { add('network-ict', false, '无法访问 gallery.developer.huaweicloud.com', '提交前需要可访问 ICT 平台，请检查网络或代理'); }
        return json(res, 200, { ok: checks.every(c => c.ok === true || c.ok === 'client'), checks });
      }
  if (req.method === 'POST' && pathname === '/api/gen-sts') {
      const input = await body(req);
      // Generate STS via local hcloud (KooCLI); requires HUAWEICLOUD_AK/SK already configured in hcloud
      const hcloudPath = [process.env.HCLOUD_EXE, ...knownHcloudPaths()].find(p => p && existsSync(p)) ?? whichSync('hcloud');
      if (!hcloudPath) return json(res, 400, { error: '未找到 hcloud (KooCLI)。请安装后重试，或直接在配置面板填 STS 凭证文件路径' });
      if (!input.accountId || !/^[0-9a-f]{32}$/i.test(input.accountId)) return json(res, 400, { error: '请提供有效的华为云账号 ID（32 位十六进制）' });
      const skillDir = resolveBundledSkillDir();
      if (!skillDir) return json(res, 400, { error: '未找到内置 ICT Skill 目录' });
      const genScript = path.join(skillDir, 'scripts', 'gen_sts.py');
      if (!existsSync(genScript)) return json(res, 400, { error: 'gen_sts.py 不存在' });
      const outDir = path.join(root, '.sts');
      await mkdir(outDir, { recursive: true });
      const credsOut = path.join(outDir, `sts-${Date.now()}.json`);
      try {
        run(resolvePython(), [genScript, '--account', input.accountId, '--hcloud', hcloudPath, '--creds-out', credsOut], { timeout: 60_000 });
        return json(res, 200, { ok: true, credsPath: credsOut });
      } catch (e) {
        return json(res, 400, { error: `STS 生成失败: ${e.message}` });
      }
    }
      const pieces = routeId(pathname, '/api/runs/');
      if (req.method === 'PUT' && pieces?.length === 2 && pieces[1] === 'file') {
        const runDir = assertRunId(pieces[0], root); const input = await body(req);
        const file = await checkedWorkFile(runDir, input.path, Boolean(input.create));
        if (typeof input.content !== 'string' || Buffer.byteLength(input.content) > 1024 * 1024) throw new Error('文件内容必须是文本且不超过 1 MiB');
        await writeFile(file, input.content, { encoding: 'utf8', mode: 0o644, flag: input.create ? 'wx' : 'w' });
        return json(res, 200, { saved: true, path: normalizeRelativePath(input.path), bytes: Buffer.byteLength(input.content) });
      }
      if (req.method === 'POST' && pieces?.length >= 2) {
        const runDir = assertRunId(pieces[0], root); const action = pieces[1]; const input = await body(req); const evidence = path.join(runDir, 'evidence');
        if (action === 'audit') return json(res, 200, await auditRun(runDir));
        if (action === 'review') return json(res, 200, await reviewFinding(runDir, input));
        if (action === 'prepare') return json(res, 200, await prepareRun(runDir, { ...input, keepPaths: input.keepPaths ?? (await readSettings(root)).cfgKeepPaths, rightsReviewed: input.rightsReviewed === true, contestRulesReviewed: input.contestRulesReviewed === true }));
        if (action === 'verify') {
          const mode = await readRunMode(runDir);
          const result = await verifyPrepared(path.join(runDir, 'work'), { allowCopy: mode === 'copy' });
          await writeJson(path.join(evidence, 'verify.json'), result);
          const record = await writeContributionRecord(runDir);
          return json(res, 200, { ...result, record });
        }
        if (action === 'mode') {
          const mode = await writeRunMode(runDir, input.mode, input.note ?? '');
          const record = await writeContributionRecord(runDir);
          return json(res, 200, { ok: true, mode, record });
        }
        if (action === 'scaffold') return json(res, 200, await scaffoldRun(runDir, { lang: input.lang, name: input.name || 'solution', force: input.force === true }));
        if (action === 'create-repo') {
          await requireVerification(runDir, '提交前验证未通过');
          const token = input.token || process.env.GITCODE_ACCESS_TOKEN;
          if (!token) throw new Error('请输入 GitCode Access Token');
          // 名称留空时跟随源仓库名（与 auto-push 同一回退链）；ICT 平台要求仓库公开可见。
          const repoSource = await readJson(path.join(runDir, 'source.json')).catch(() => null);
          const repoName = input.name || repoNameFromUrl(repoSource?.sourceUrl ?? '') || repoNameFromLocal(repoSource?.localName ?? '') || 'contest-project';
          const result = await createOrReuseGitCodeRepo({ name: repoName, description: input.description || '', privateRepo: false, token });
          await writeJson(path.join(evidence, 'repository.json'), result);
          return json(res, 200, result);
        }
        if (action === 'init-repo') {
          await requireVerification(runDir, '初始化前验证未通过');
          const repository = input.remote ? { cloneUrl: input.remote } : await readJson(path.join(evidence, 'repository.json'));
          const result = initPreparedRepo(path.join(runDir, 'work'), { remote: repository.cloneUrl, authorName: input.authorName, authorEmail: input.authorEmail });
          await writeJson(path.join(evidence, 'repository-init.json'), result);
          return json(res, 200, result);
        }
        if (action === 'push') {
          await requireVerification(runDir, '上传前验证未通过', { allowGit: true });
          const result = pushPreparedRepo(path.join(runDir, 'work'), { remote: input.remote, branch: input.branch || 'main', execute: input.execute !== false, authorName: input.authorName, authorEmail: input.authorEmail });
          if (!result.dryRun) await writeJson(path.join(evidence, 'push.json'), result);
          return json(res, 200, result);
        }
        if (action === 'select-problem') return json(res, 200, await selectCompetitionProblem({ runDir, skillDir: input.skillDir || BUNDLED_SKILL_DIR, number: Number(input.number), creds: input.creds }));
        if (action === 'auto-run') {
          // Automated pipeline: audit -> auto-resolve safe findings -> prepare -> verify
          const log = [];
          const step = (name, status, detail) => { log.push({ name, status, detail }); return { name, status, detail }; };
          let audit;
          try { audit = await auditRun(runDir); step('audit', 'done', `审计完成：${audit.summary?.trackedFiles ?? 0} 个文件`); }
          catch (e) { step('audit', 'error', e.message); return json(res, 200, { ok: false, stage: 'audit', log }); }
          if (audit.summary?.status === 'blocked') { step('audit', 'blocked', '审计存在阻断项（凭证/子模块等）'); return json(res, 200, { ok: false, stage: 'audit', log, audit }); }

          // Auto-resolve non-blocking review findings with the only decision each category allows.
          // license findings accept nothing but license-reviewed, and a project-identity finding
          // without a file can only be a false positive.
          const reviewable = (audit.findings ?? []).filter(f => f.disposition === 'review');
          let resolved = 0;
          const secretFiles = new Set();
          for (const f of reviewable) {
            const withFile = Boolean(f.file);
            // 密钥：唯一合法处置是把该文件排除出副本（密钥本身绝不进入提交内容）。
            const decision = f.category === 'secret' ? 'exclude-file'
              : f.category === 'personal-data' ? 'sanitize'
              : f.category === 'environment-path' ? 'sanitize'
              : f.category === 'license' ? 'license-reviewed'
              : f.category === 'project-identity' || f.category === 'repository' ? (withFile ? 'exclude-file' : 'false-positive')
              : 'false-positive';
            try {
              await reviewFinding(runDir, { findingId: f.id, decision, note: `自动处理：${f.category}` });
              resolved += 1;
              if (f.category === 'secret' && f.file) secretFiles.add(f.file);
              if (f.category === 'license') step('review', 'warn', `许可证发现已按“已审阅许可证”记录（${f.pattern ?? 'license'}），请自行确认来源合规`);
            } catch (e) { step('review', 'warn', `${f.id}: ${e.message}`); }
          }
          if (resolved) step('review', 'done', `自动处理 ${resolved} 条发现`);
          if (secretFiles.size) step('review', 'warn', `含疑似凭证的 ${secretFiles.size} 个文件已排除出副本：${[...secretFiles].slice(0, 5).join('、')}${secretFiles.size > 5 ? ' 等' : ''}`);

          // Retain-attribution findings auto-confirmed (license info is kept by policy)
          const retain = (audit.findings ?? []).filter(f => f.disposition === 'retain-attribution');
          let retained = 0;
          for (const f of retain) {
            try { await reviewFinding(runDir, { findingId: f.id, decision: 'retain-attribution', note: '自动保留归属信息' }); retained += 1; }
            catch (e) { step('review', 'warn', `${f.id}: ${e.message}`); }
          }
          if (retained) step('review', 'done', `自动保留 ${retained} 条归属信息`);
          if (!resolved && !retained) step('review', 'done', '无需人工处理');

          let prepared;
          try { prepared = await prepareRun(runDir, { name: input.name || 'contest-project', keepPaths: input.keepPaths ?? (await readSettings(root)).cfgKeepPaths, rightsReviewed: true, contestRulesReviewed: true }); step('prepare', 'done', `工作副本已生成：${prepared.manifest?.copied?.length ?? 0} 个文件${prepared.manifest?.keepPaths?.length ? `（含保留路径 ${prepared.manifest.keepPaths.join('、')}）` : ''}`); }
          catch (e) { step('prepare', 'error', e.message); return json(res, 200, { ok: false, stage: 'prepare', log }); }

          let verified;
          try {
            const mode = await readRunMode(runDir);
            verified = await verifyPrepared(path.join(runDir, 'work'), { allowCopy: mode === 'copy' });
            await writeJson(path.join(evidence, 'verify.json'), verified);
            await writeContributionRecord(runDir);
            step('verify', verified.status === 'passed' ? 'done' : 'blocked', verified.status === 'passed' ? `验证通过${mode === 'copy' ? '（搬运模式：原创增量已豁免）' : ''}` : `验证状态：${verified.status}`);
          }
          catch (e) { step('verify', 'error', e.message); return json(res, 200, { ok: false, stage: 'verify', log }); }

          return json(res, 200, { ok: verified.status === 'passed', stage: 'verify', log, verified });
        }
        if (action === 'auto-push') {
          // Automated remote steps: create-repo -> init-repo -> push -> select-problem -> submit
          // Each step is written into autoPushProgress as it starts and finishes so the
          // workbench can poll live progress while this single long request is in flight.
          const log = [];
          const prog = { runDir, stage: 'running', startedAt: new Date().toISOString(), finishedAt: null, error: null, current: null, steps: [] };
          autoPushProgress.set(runDir, prog);
          const labels = { verify: '验证工作副本', 'create-repo': '创建 GitCode 仓库', 'public-repo': '确保仓库公开（平台要求）', 'init-repo': '初始化本地仓库', push: '推送代码到 GitCode', 'select-problem': '查询并锁定 ICT 赛题', submit: '生成提交计划/执行提交' };
          prog.total = Object.keys(labels).length;
          const step = (name, status, detail) => {
            log.push({ name, status, detail });
            const pending = prog.steps.find(item => item.name === name && item.status === 'running');
            if (pending) { pending.status = status; pending.detail = detail; }
            else prog.steps.push({ name, label: labels[name] ?? name, status, detail });
            prog.current = status === 'running' ? name : (prog.current === name ? null : prog.current);
          };
          const running = name => step(name, 'running', `${labels[name] ?? name}…`);
          const respond = payload => {
            prog.stage = payload.ok ? 'done' : 'error';
            prog.error = payload.error ?? null;
            prog.finishedAt = new Date().toISOString();
            return json(res, 200, payload);
          };
          const cfg = input.config || {};
          const token = cfg.gitToken || process.env.GITCODE_ACCESS_TOKEN;
          // 目标仓库名默认跟随源仓库名（用户没填 repoName 时），避免固定落到 contest-project。
          const sourceMeta = await readJson(path.join(runDir, 'source.json')).catch(() => null);
          const suggestedRepoName = repoNameFromUrl(sourceMeta?.sourceUrl ?? '') || repoNameFromLocal(sourceMeta?.localName ?? '') || 'contest-project';
          if (!token) return respond({ ok: false, stage: 'create-repo', log, error: '缺少 GitCode Access Token' });

          running('verify');
          try {
            await requireVerification(runDir, '推送前验证未通过', { allowGit: true });
            step('verify', 'done', '验证通过');
          } catch (e) { step('verify', 'error', e.message); return respond({ ok: false, stage: 'verify', log, error: e.message }); }

          // 1. create-repo (idempotent: skip if repository.json exists)
          running('create-repo');
          let repoRecord;
          try {
            repoRecord = await readJson(path.join(evidence, 'repository.json'));
            step('create-repo', 'done', `复用已创建仓库：${repoRecord.name || repoRecord.cloneUrl}`);
          } catch {
            try {
              repoRecord = await createOrReuseGitCodeRepo({ name: cfg.repoName || suggestedRepoName, description: cfg.repoDescription || '', privateRepo: false, token });
              await writeJson(path.join(evidence, 'repository.json'), repoRecord);
              step('create-repo', 'done', repoRecord.reused ? `复用已存在的同名仓库：${repoRecord.cloneUrl}` : `公开仓库已创建：${repoRecord.cloneUrl || repoRecord.name}`);
            } catch (e) { step('create-repo', 'error', e.message); return respond({ ok: false, stage: 'create-repo', log, error: e.message }); }
          }

          // 2. public-repo：ICT 平台只接受所有人可见的仓库。老 run（含本工具旧版本）建的是私有仓库，
          //    这里幂等地改回公开；创建时已公开则是一次无副作用的确认调用。
          running('public-repo');
          try {
            const visibility = await setGitCodeRepoVisibility({ webUrl: repoRecord.cloneUrl || repoRecord.webUrl, privateRepo: false, token });
            repoRecord = { ...repoRecord, private: visibility.private, public: visibility.public };
            await writeJson(path.join(evidence, 'repository.json'), repoRecord);
            step('public-repo', 'done', visibility.public ? '仓库已公开可见（所有人可见）' : '公开请求已发送，平台未确认公开状态');
          } catch (e) { step('public-repo', 'error', e.message); return respond({ ok: false, stage: 'public-repo', log, error: e.message }); }

          // 3. init-repo (idempotent: skip if .git exists)
          running('init-repo');
          const workDir = path.join(runDir, 'work');
          const gitDir = path.join(workDir, '.git');
          try {
            await lstat(gitDir);
            step('init-repo', 'done', '本地仓库已初始化，跳过');
          } catch {
            try {
              const initResult = initPreparedRepo(workDir, { remote: repoRecord.cloneUrl, authorName: cfg.authorName || 'Contest Author', authorEmail: cfg.authorEmail || 'author@example.invalid' });
              await writeJson(path.join(evidence, 'repository-init.json'), initResult);
              const ws = initResult.whitespace?.length ?? 0;
              step('init-repo', 'done', `本地仓库已初始化${ws ? `（${ws} 处行尾空白告警，仅提示不影响推送）` : ''}`);
            } catch (e) { step('init-repo', 'error', e.message); return respond({ ok: false, stage: 'init-repo', log, error: e.message }); }
          }

          // 4. push
          running('push');
          try {
            const pushResult = pushPreparedRepo(workDir, { remote: repoRecord.cloneUrl, branch: 'main', execute: true, authorName: cfg.authorName, authorEmail: cfg.authorEmail });
            await writeJson(path.join(evidence, 'push.json'), pushResult);
            step('push', 'done', `代码已推送 ${pushResult.branch || 'main'}`);
          } catch (e) { step('push', 'error', e.message); return respond({ ok: false, stage: 'push', log, error: e.message }); }

          // 5. select-problem
          running('select-problem');
          let selected;
          try {
            selected = await selectCompetitionProblem({ runDir, skillDir: cfg.skillDir || BUNDLED_SKILL_DIR, number: Number(cfg.problemNumber || 1), creds: cfg.credsPath });
            step('select-problem', 'done', `已锁定：${selected.problemName}`);
          } catch (e) { step('select-problem', 'error', e.message); return respond({ ok: false, stage: 'select-problem', log, error: e.message }); }

          // 6. submit
          running('submit');
          try {
            const targetLock = path.join(evidence, '.ict-target.json');
            const result = await buildSubmitPlan({
              workDir, skillDir: cfg.skillDir || BUNDLED_SKILL_DIR, problemId: selected.problemId, trainingCampId: selected.trainingCampId,
              problemName: selected.problemName, windowStart: selected.windowStart, windowEnd: selected.windowEnd,
              targetLock, creds: cfg.credsPath, execute: cfg.executeSubmit === true, evidenceDir: evidence,
            });
            if (cfg.executeSubmit) await writeJson(path.join(evidence, 'submission.json'), { submittedAt: new Date().toISOString(), problemId: selected.problemId, problemName: selected.problemName, ...parseSubmitOutput(result.submissionOutput), result: result.submissionOutput });
            step('submit', cfg.executeSubmit ? 'done' : 'plan', cfg.executeSubmit ? '作品已提交' : '提交计划已生成（未执行）');
            return respond({ ok: true, stage: 'submit', log, result });
          } catch (e) { step('submit', 'error', e.message); return respond({ ok: false, stage: 'submit', log, error: e.message }); }
        }
        if (action === 'submit') {
          await requireVerification(runDir, '提交前验证未通过', { allowGit: true });
          let selected;
          try { selected = await readJson(path.join(evidence, 'selected-problem.json')); }
          catch { throw new Error('尚未锁定赛题：请先点「查询并锁定赛题」，再生成提交计划或执行提交'); }
          const targetLock = path.join(evidence, '.ict-target.json');
          const result = await buildSubmitPlan({
            workDir: path.join(runDir, 'work'), skillDir: input.skillDir || BUNDLED_SKILL_DIR, problemId: selected.problemId, trainingCampId: selected.trainingCampId,
            problemName: selected.problemName, windowStart: selected.windowStart, windowEnd: selected.windowEnd, targetLock, creds: input.creds,
            execute: Boolean(input.execute), evidenceDir: evidence,
          });
          if (input.execute) await writeJson(path.join(evidence, 'submission.json'), { submittedAt: new Date().toISOString(), problemId: selected.problemId, problemName: selected.problemName, ...parseSubmitOutput(result.submissionOutput), result: result.submissionOutput });
          return json(res, 200, result);
        }
        // 判题结果查询（A2）：判题由平台异步回传，failureReason 是"为什么没通过"的权威来源。
        if (action === 'judge-status') {
          let submission = null;
          try { submission = await readJson(path.join(evidence, 'submission.json')); } catch {}
          const submissionId = input.submissionId || submission?.submissionId;
          if (!submissionId) throw new Error('尚未提交：先完成一次提交（成功后会记录 submissionId），或手动传入 submissionId');
          const status = await fetchSubmissionStatus({ skillDir: input.skillDir || BUNDLED_SKILL_DIR, creds: input.creds, submissionId });
          await writeJson(path.join(evidence, 'judgement.json'), status);
          const judged = status.judgeStatus && status.judgeStatus !== 'pending';
          return json(res, 200, { ok: true, judged, ...status });
        }
      }
      return json(res, 404, { error: 'Not found' });
  } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

// 定位内置 ICT Skill：打包态看可执行文件旁边（mac 的 .app 是 Contents/Resources，
// Windows 绿色包是 exe 同目录），开发态看项目根目录；仓库里自带的那份在项目根目录下，
// 本地工作区则通常与 contest-publisher 并排，所以再兜一层上一级目录。
function resolveBundledSkillDir() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const candidates = [];
  for (const root of [...sidecarRoots(), path.resolve(projectRoot, '..')]) {
    candidates.push(path.join(root, 'huawei-cloud-publish-ict-work'));
  }
  for (const candidate of candidates) {
    try { if (existsSync(path.join(candidate, 'scripts', 'list-problems.mjs'))) return candidate; } catch {}
  }
  return null;
}
const BUNDLED_SKILL_DIR = resolveBundledSkillDir();

export async function startApiServer({ host = '127.0.0.1', port = 0, runsRoot } = {}) {
  // Without an explicit --runs-root the remembered workspace, then the env, then the default wins.
  const initialRoot = resolveRunsRoot(runsRoot) ?? await defaultRunsRoot();
  const workspace = { root: initialRoot, mutable: true };
  const handle = (req, res) => handleApiRequest(req, res, workspace);
  const server = http.createServer(handle);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, handleApiRequest: handle, root: workspace.root, workspace, port: server.address().port, host };
}
