import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { exists, readJson } from './store.mjs';
import { CONTRIBUTIONS_LINE, GITIGNORE_TEMPLATE } from './prepare.mjs';

// Files the tool generates into work/ — they have no upstream counterpart by design.
const GENERATED_FILES = ['README.md', 'UPSTREAM.md', 'CONTRIBUTIONS.md', '.gitignore', '.contest-publisher-manifest.json'];
// Fallback for runs prepared before prepare.json recorded generated-file hashes: the placeholder
// text is still in the file when the author has not touched it yet.
const GENERATED_PLACEHOLDERS = {
  'CONTRIBUTIONS.md': 'TODO: describe the behavior',
  'README.md': 'Describe the independently implemented competition functionality here.',
  'UPSTREAM.md': CONTRIBUTIONS_LINE,
};

const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_DIFF_LINES = 5000;
const LCS_LINE_CAP = 1500;

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function listFiles(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

function splitLines(text) {
  if (!text.length) return [];
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: 'equal', text: a[i] }); i += 1; j += 1; }
    else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) { ops.push({ type: 'del', text: a[i] }); i += 1; }
    else { ops.push({ type: 'add', text: b[j] }); j += 1; }
  }
  while (i < n) { ops.push({ type: 'del', text: a[i] }); i += 1; }
  while (j < m) { ops.push({ type: 'add', text: b[j] }); j += 1; }
  return ops;
}

// Line diff with common prefix/suffix trimming; falls back to a coarse replace-all
// when the differing middle is larger than the LCS cap (still correct, just less precise).
function diffLines(a, b) {
  let start = 0;
  const shortest = Math.min(a.length, b.length);
  while (start < shortest && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const ops = [];
  for (let i = 0; i < start; i += 1) ops.push({ type: 'equal', text: a[i] });
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  if (middleA.length > LCS_LINE_CAP || middleB.length > LCS_LINE_CAP) {
    for (const line of middleA) ops.push({ type: 'del', text: line });
    for (const line of middleB) ops.push({ type: 'add', text: line });
  } else {
    ops.push(...lcsOps(middleA, middleB));
  }
  for (let i = endA; i < a.length; i += 1) ops.push({ type: 'equal', text: a[i] });
  return ops;
}

function buildHunks(ops, context) {
  const numbers = [];
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    numbers.push([oldLine, newLine]);
    if (op.type !== 'add') oldLine += 1;
    if (op.type !== 'del') newLine += 1;
  }
  const changed = [];
  ops.forEach((op, index) => { if (op.type !== 'equal') changed.push(index); });
  if (!changed.length) return [];
  const ranges = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length - 1, index + context);
    const last = ranges.at(-1);
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  return ranges.map(range => {
    const slice = ops.slice(range.start, range.end + 1);
    const oldCount = slice.filter(op => op.type !== 'add').length;
    const newCount = slice.filter(op => op.type !== 'del').length;
    return {
      header: `@@ -${numbers[range.start][0]},${oldCount} +${numbers[range.start][1]},${newCount} @@`,
      lines: slice.map(op => ({ type: op.type, text: op.text })),
    };
  });
}

async function readOptionally(file) {
  try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/**
 * Compare the prepared work copy against the pinned source checkout.
 *
 * Per file it separates three questions:
 *   - 和原仓库比，内容是不是变了（status: added / modified / unchanged / deleted）
 *   - 变化里哪些是 prepare 的脱敏改写（rewrittenByTool，依据 prepare.json 的 sourceSha256 vs preparedSha256）
 *   - 哪些是你后来自己改的（editedByAuthor，依据 work 内容 vs preparedSha256）
 */
export async function diffRun(runDir, { context = 3, path: only, includeHunks = true, maxBytes = MAX_DIFF_BYTES, maxLines = MAX_DIFF_LINES } = {}) {
  const root = path.resolve(runDir);
  const source = path.join(root, 'source');
  const work = path.join(root, 'work');
  if (!(await exists(source))) throw new Error(`Run has no source checkout: ${source}`);
  if (!(await exists(work))) throw new Error(`Run has no work copy yet: ${work}`);

  let prepare = null;
  try { prepare = await readJson(path.join(root, 'evidence', 'prepare.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const copied = new Map((prepare?.copied ?? []).map(item => [item.path, item]));
  // `prepare.generated` is a list of { path, sha256 } in current runs, or a bare path list in
  // runs prepared by an earlier build — accept both shapes.
  const generatedHashes = new Map((prepare?.generated ?? [])
    .filter(item => item && typeof item === 'object' && item.path && item.sha256)
    .map(item => [item.path, item.sha256]));
  const replacedByFile = new Map();
  for (const replacement of prepare?.replacements ?? []) {
    const list = replacedByFile.get(replacement.file) ?? [];
    list.push({ kind: replacement.kind, from: replacement.from });
    replacedByFile.set(replacement.file, list);
  }

  const files = [];
  const seen = new Set();
  for (const relative of await listFiles(work)) {
    seen.add(relative);
    const workBuffer = await readFile(path.join(work, ...relative.split('/')));
    const workSha256 = sha256(workBuffer);
    const meta = copied.get(relative);
    const sourceBuffer = await readOptionally(path.join(source, ...relative.split('/')));
    const text = workBuffer.includes(0) ? null : workBuffer.toString('utf8');
    // A generated file is one prepare wrote itself. `.gitignore` is the only generated name that can
    // also exist upstream; runs prepared before that skip was added recorded a copied entry whose
    // content prepare then replaced, so compare against the tool's fixed template to stay accurate.
    const generated = !meta
      ? GENERATED_FILES.includes(relative)
      : relative === '.gitignore' && text === GITIGNORE_TEMPLATE;

    let status = 'unchanged';
    if (!sourceBuffer) status = 'added';
    else if (sha256(sourceBuffer) !== workSha256) status = 'modified';

    const rewrittenByTool = Boolean(meta && meta.sourceSha256 !== meta.preparedSha256);
    // "You changed it" is measured against whatever the tool last wrote for that file: the recorded
    // generated hash, the sanitized copy hash, or (legacy runs) the placeholder text.
    let editedByAuthor;
    if (generated) {
      const baseline = generatedHashes.get(relative) ?? (relative === '.gitignore' ? sha256(Buffer.from(GITIGNORE_TEMPLATE)) : null);
      const marker = GENERATED_PLACEHOLDERS[relative];
      editedByAuthor = baseline ? workSha256 !== baseline : Boolean(marker && text !== null && !text.includes(marker));
    } else {
      editedByAuthor = meta ? workSha256 !== meta.preparedSha256 : true;
    }

    const entry = {
      path: relative,
      kind: meta?.kind ?? (generated ? 'generated' : null),
      status,
      origin: generated ? 'generated' : meta ? 'upstream' : 'author',
      sourceSha256: meta?.sourceSha256 ?? (sourceBuffer ? sha256(sourceBuffer) : null),
      preparedSha256: meta?.preparedSha256 ?? null,
      workSha256,
      rewrittenByTool,
      editedByAuthor,
      replacements: replacedByFile.get(relative) ?? [],
      binary: workBuffer.includes(0),
      addedLines: 0,
      removedLines: 0,
      diff: null,
    };

    if (status === 'unchanged') {
      entry.addedLines = 0;
      entry.removedLines = 0;
    } else if (entry.binary || workBuffer.length > maxBytes || workBuffer.length > maxLines * 200) {
      entry.addedLines = null;
      entry.removedLines = null;
      entry.diff = { truncated: true, reason: entry.binary ? 'binary' : 'file too large for a line diff' };
    } else {
      const before = sourceBuffer ? splitLines(sourceBuffer.toString('utf8')) : [];
      const after = splitLines(workBuffer.toString('utf8'));
      const ops = diffLines(before, after);
      entry.addedLines = ops.filter(op => op.type === 'add').length;
      entry.removedLines = ops.filter(op => op.type === 'del').length;
      if (includeHunks) entry.diff = { hunks: buildHunks(ops, context) };
    }
    files.push(entry);
  }

  // Files that prepare copied but that no longer exist in work/.
  for (const [relative, meta] of copied) {
    if (seen.has(relative)) continue;
    files.push({
      path: relative,
      kind: meta.kind,
      status: 'deleted',
      origin: 'upstream',
      sourceSha256: meta.sourceSha256,
      preparedSha256: meta.preparedSha256,
      workSha256: null,
      rewrittenByTool: meta.sourceSha256 !== meta.preparedSha256,
      editedByAuthor: true,
      replacements: replacedByFile.get(relative) ?? [],
      binary: false,
      addedLines: 0,
      removedLines: null,
      diff: includeHunks ? { truncated: true, reason: 'file removed from the work copy' } : null,
    });
  }

  // Display order: your changes and upstream-derived files first, tool-generated bookkeeping
  // last, unchanged last of all — so the interesting rows are on top in both CLI and UI.
  const rank = file => (file.status === 'unchanged' ? 2 : 0) + (file.origin === 'generated' ? 1 : 0);
  files.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  const summary = {
    comparedAgainst: prepare?.sourceCommit ?? null,
    total: files.length,
    added: files.filter(file => file.status === 'added').length,
    modified: files.filter(file => file.status === 'modified').length,
    deleted: files.filter(file => file.status === 'deleted').length,
    unchanged: files.filter(file => file.status === 'unchanged').length,
    generated: files.filter(file => file.origin === 'generated').length,
    rewrittenByTool: files.filter(file => file.rewrittenByTool).length,
    editedByAuthor: files.filter(file => file.editedByAuthor).length,
    editedAndRewritten: files.filter(file => file.editedByAuthor && file.rewrittenByTool).length,
    changedFiles: files.filter(file => file.status !== 'unchanged').length,
    addedLines: files.reduce((total, file) => total + (file.addedLines ?? 0), 0),
    removedLines: files.reduce((total, file) => total + (file.removedLines ?? 0), 0),
  };

  const selected = only ? files.filter(file => file.path === only) : files;
  if (only && !selected.length) throw new Error(`No such file in the work copy: ${only}`);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runDir: root,
    sourceCommit: prepare?.sourceCommit ?? null,
    summary,
    files: selected,
    excluded: prepare?.excluded ?? [],
    replacements: prepare?.replacements ?? [],
  };
}

function describeFile(file) {
  const label = file.status === 'added' ? '新增' : file.status === 'deleted' ? '删除' : '修改';
  const flags = [];
  if (file.origin === 'generated') flags.push('工具生成');
  if (file.rewrittenByTool) flags.push('工具脱敏改写');
  if (file.editedByAuthor) flags.push('你的改动');
  const counts = file.addedLines === null ? '（未统计行数）' : `+${file.addedLines} -${file.removedLines}`;
  return `${label}\t${file.path}\t${counts}${flags.length ? `\t[${flags.join(' / ')}]` : ''}`;
}

export function formatDiffReport(report, { stat = false } = {}) {
  const lines = [];
  const s = report.summary;
  lines.push(`对比原仓库 (source${report.sourceCommit ? `@${report.sourceCommit.slice(0, 12)}` : ''}) → work`);
  lines.push(`  新增 ${s.added} · 修改 ${s.modified} · 删除 ${s.deleted} · 未变 ${s.unchanged}（工具生成 ${s.generated}，工具脱敏改写 ${s.rewrittenByTool}，你改动 ${s.editedByAuthor}）`);
  lines.push(`  行数：+${s.addedLines} -${s.removedLines}`);
  const changed = report.files.filter(file => file.status !== 'unchanged');
  if (!changed.length) lines.push('  work/ 与 source/ 内容一致（只有工具生成的说明文件）');
  lines.push('');
  for (const file of changed) {
    lines.push(describeFile(file));
    if (stat) continue;
    const hunks = file.diff?.hunks;
    if (!hunks?.length) {
      if (file.diff?.truncated) lines.push(`    （未生成逐行差异：${file.diff.reason}）`);
      lines.push('');
      continue;
    }
    lines.push(`--- a/${file.path}`);
    lines.push(`+++ b/${file.path}`);
    for (const hunk of hunks) {
      lines.push(hunk.header);
      for (const line of hunk.lines) lines.push(`${line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}${line.text}`);
    }
    lines.push('');
  }
  if (report.excluded.length) {
    lines.push('未进入 work/ 的源文件（按策略排除）：');
    for (const item of report.excluded) lines.push(`  ${item.path}\t${item.kind}\t${item.reason}`);
  }
  return `${lines.join('\n')}\n`;
}
