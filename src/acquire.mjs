import path from 'node:path';
import os from 'node:os';
import { cp, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { ensureDir, ensureLocalSourcesDir, exists, inside, removeEmptyOrMissing, runId, writeJson } from './store.mjs';
import { run, runGit } from './process.mjs';

export function validateSourceUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Source URL must be a valid HTTPS URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Source URL must use HTTPS and contain no credentials, query string, or fragment');
  }
  if (!parsed.hostname || parsed.pathname === '/') throw new Error('Source URL must identify a Git repository');
  return parsed.toString().replace(/\/$/, '');
}

// 目标仓库名默认跟随源仓库：https://gitcode.com/org/Project.git → Project。
// 只剔除空白与路径/保留字符（保留中文等 Unicode 字母）；全被过滤掉时返回空串，由调用方决定兜底名。
export function repoNameFromUrl(sourceUrl) {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const base = pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(base).replace(/\.git$/i, '').replace(/[\s/\\:*?"<>|]+/g, '');
  } catch {
    return '';
  }
}

// 本地仓库名 → 目标仓库名：GitHub 的 Download ZIP 常带 `-main`/`-master` 后缀，去掉更像项目名。
export function repoNameFromLocal(entryName) {
  const base = String(entryName ?? '').trim().replace(/\.zip$/i, '');
  return base.replace(/-(?:main|master)$/i, '').replace(/[\s/\\:*?"<>|]+/g, '');
}

// 列出本地仓库里可直接用的条目（文件夹或 zip），按名称排序。
export async function listLocalSources(dir) {
  const root = await ensureLocalSourcesDir(dir);
  const entries = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'README.txt') continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, kind: 'dir', bytes: null, modifiedAt: (await stat(target)).mtime.toISOString() });
    } else if (entry.isFile() && /\.zip$/i.test(entry.name)) {
      entries.push({ name: entry.name, kind: 'zip', bytes: (await stat(target)).size, modifiedAt: (await stat(target)).mtime.toISOString() });
    }
  }
  return { dir: root, entries: entries.sort((a, b) => a.name.localeCompare(b.name)) };
}

// 本地源快照：把文件夹原样复制（或把 zip 解压）到 run 的 source/，再初始化成单提交 git 仓库——
// 审计 / 对比 / 验证都按 git 索引工作，这样本地源与 Git 源走完全相同的下游流程。
export async function acquireLocalSource({ entryName, sourcesDir, runsRoot }) {
  const root0 = await ensureLocalSourcesDir(sourcesDir);
  const name = String(entryName ?? '').trim();
  if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) throw new Error('本地源名称不合法');
  const entry = path.resolve(root0, name);
  if (!inside(root0, entry) || entry === root0) throw new Error('本地源必须位于本地仓库目录内');
  if (!(await exists(entry))) throw new Error(`本地仓库里没有「${name}」，请放入代码包后点「刷新列表」`);
  const info = await stat(entry);
  const isZip = info.isFile() && /\.zip$/i.test(name);
  if (!info.isDirectory() && !isZip) throw new Error('本地源必须是文件夹或 .zip 代码包');

  if (!runsRoot) runsRoot = process.env.CONTEST_PUBLISHER_RUNS || path.resolve(process.env.HOME || os.homedir(), 'contest-publisher-runs');
  const root = path.resolve(runsRoot, runId());
  await ensureDir(path.dirname(root));
  await removeEmptyOrMissing(root);
  await ensureDir(root);
  const source = path.join(root, 'source');
  try {
    if (isZip) {
      const staging = path.join(root, '.extract');
      await ensureDir(staging);
      extractZip(entry, staging);
      // GitHub 的 zip 只有一层顶层目录时展平，让 source/ 直接是项目根。
      const top = (await readdir(staging)).filter(item => item !== '__MACOSX');
      const flattened = top.length === 1 && (await stat(path.join(staging, top[0]))).isDirectory();
      await cp(flattened ? path.join(staging, top[0]) : staging, source, { recursive: true, filter: skipJunk });
      const { rm } = await import('node:fs/promises');
      await rm(staging, { recursive: true, force: true });
    } else {
      await cp(entry, source, { recursive: true, filter: skipJunk });
    }
    const staged = await readdir(source);
    if (!staged.length) throw new Error('代码包是空的');
    // 冻结成只读快照：审计依赖 git 索引，本地源与 Git 源下游完全一致。
    runGit(['init', '-q', source]);
    runGit(['-C', source, 'add', '-A']);
    runGit(['-C', source, '-c', 'user.name=Contest Publisher', '-c', 'user.email=author@example.invalid', 'commit', '-qm', `Local source snapshot: ${name}`]);
    const commit = runGit(['-C', source, 'rev-parse', '--verify', 'HEAD^{commit}']).trim();
    const sourceMeta = {
      schemaVersion: 1,
      sourceKind: 'local',
      localName: name,
      sourceUrl: null,
      requestedRef: null,
      commit,
      fetchedAt: new Date().toISOString(),
      note: 'Local source snapshot is immutable input; all preparation occurs in a separate work directory.',
    };
    await writeJson(path.join(root, 'source.json'), sourceMeta);
    // 本地代码包就是作者自己的成品，没有"相对上游的原创增量"可言——严格模式必然卡在验证。
    // 默认按搬运模式发布（豁免增量门禁并留痕），用户仍可在 03 面板切回严格模式。
    await writeJson(path.join(root, 'evidence', 'run-mode.json'), {
      schemaVersion: 1,
      mode: 'copy',
      note: `本地代码包「${name}」直接发布：无上游基线，原创增量门禁不适用`,
      setAt: new Date().toISOString(),
      consequence: '原创代码增量豁免：本运行按本地代码包直接发布处理，其余门禁（凭证、语法、文档、贡献记录）仍然生效。',
    });
    return { runDir: root, sourceDir: source, source: sourceMeta };
  } catch (error) {
    await writeJson(path.join(root, 'acquire-failure.json'), { at: new Date().toISOString(), error: error.message });
    throw new Error(`本地源快照失败；证据保留在 ${root}: ${error.message}`);
  }
}

// 只跳过版本库元数据与系统杂物，代码包内容一律保留。
function skipJunk(src) {
  const base = path.basename(src);
  return base !== '.git' && base !== '.DS_Store' && base !== '__MACOSX';
}

// 解压 zip 的命令序列，按顺序尝试。每项都是对应平台自带的，不额外装东西：
// unix 用 ditto（保留 UTF-8 文件名）→ unzip；
// Windows 用系统自带的 bsdtar（Win10 1803+ 的 tar.exe 能读 zip）→ PowerShell Expand-Archive。
export function zipExtractCommands(zipFile, dest, platform = process.platform) {
  if (platform === 'win32') {
    return [
      { command: 'tar', args: ['-xf', zipFile, '-C', dest] },
      { command: 'powershell', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath ${psQuote(zipFile)} -DestinationPath ${psQuote(dest)} -Force`] },
    ];
  }
  return [
    { command: '/usr/bin/ditto', args: ['-x', '-k', zipFile, dest] },
    { command: '/usr/bin/unzip', args: ['-qq', '-o', zipFile, '-d', dest] },
  ];
}

// PowerShell 单引号字符串里只有单引号需要转义（写成两个单引号）。
function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function extractZip(zipFile, dest) {
  const failures = [];
  for (const { command, args } of zipExtractCommands(zipFile, dest)) {
    try { run(command, args, { timeout: 300_000 }); return; }
    catch (error) { failures.push(error.message); }
  }
  throw new Error(`无法解压 ${path.basename(zipFile)}：${failures.join(' | ')}`);
}

export async function acquireSource({ sourceUrl, ref = 'HEAD', runsRoot }) {
  // Resolve runsRoot: explicit arg > env > home dir (avoid EROFS in packaged app)
  if (!runsRoot) runsRoot = process.env.CONTEST_PUBLISHER_RUNS || path.resolve(process.env.HOME || os.homedir(), 'contest-publisher-runs');
  const safeUrl = validateSourceUrl(sourceUrl);
  if (!/^[A-Za-z0-9._/-]+$/.test(ref) || ref.startsWith('-') || ref.includes('..')) throw new Error('Ref contains unsupported characters');
  const root = path.resolve(runsRoot, runId());
  await ensureDir(path.dirname(root));
  await removeEmptyOrMissing(root);
  await ensureDir(root);
  const source = path.join(root, 'source');
  try {
    runGit(['clone', '--no-recurse-submodules', '--no-tags', '--', safeUrl, source], { timeout: 300_000 });
    const commit = runGit(['-C', source, 'rev-parse', '--verify', `${ref}^{commit}`]).trim();
    runGit(['-C', source, 'checkout', '--detach', commit]);
    const sourceMeta = {
      schemaVersion: 1,
      sourceUrl: safeUrl,
      requestedRef: ref,
      commit,
      fetchedAt: new Date().toISOString(),
      note: 'Source checkout is immutable input; all preparation occurs in a separate work directory.',
    };
    await writeJson(path.join(root, 'source.json'), sourceMeta);
    return { runDir: root, sourceDir: source, source: sourceMeta };
  } catch (error) {
    // Keep failed-run evidence rather than deleting a partially fetched source.
    await writeJson(path.join(root, 'acquire-failure.json'), { at: new Date().toISOString(), error: error.message });
    throw new Error(`Source acquisition failed; partial evidence kept at ${root}: ${error.message}`);
  }
}
