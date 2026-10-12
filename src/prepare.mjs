import path from 'node:path';
import { mkdir, readFile, lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { auditRun } from './audit.mjs';
import { isKeptPath, isPlaceholderEmail, newPhonePattern, normalizeKeepPaths } from './policy.mjs';
import { ensureDir, exists, inside, readJson, writeJson } from './store.mjs';

const ABSOLUTE_USER_PATH = /\/(?:Users|home)\/[^/\s]+(?:\/[^\s"'`)]*)?|\/root\/[^\s"'`)]*/g;
const CREDENTIAL_URL = /https?:\/\/[^\s/@:]+:[^\s/@]+@/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

// Files prepare always writes itself. They must never be copied from upstream first: the copy
// would be overwritten (and its hash recorded), which would later look like an author edit in
// `diff`. README.md is deliberately not in this set — an upstream README is documentation and is
// kept; the tool only writes its transparent stub when the source had none.
const ALWAYS_GENERATED_FILES = new Set(['UPSTREAM.md', 'CONTRIBUTIONS.md', '.gitignore', '.contest-publisher-manifest.json']);
export const GITIGNORE_TEMPLATE = 'node_modules/\ndist/\nbuild/\ncoverage/\n.cache/\n.env\n.env.*\n!.env.example\n.DS_Store\n';

/** Still-unanswered stub that prepare writes into CONTRIBUTIONS.md. */
export const CONTRIBUTIONS_STUB_MARKER = 'TODO: describe the behavior';
/** The single line every tool-written submission notice carries — UPSTREAM.md and every
 *  CONTRIBUTIONS.md section use it verbatim, so the submitted tree speaks with one voice. */
export const CONTRIBUTIONS_LINE = '此为大赛提交所建';
/** Records written by older builds pointed at UPSTREAM.md instead of carrying the line. */
const LEGACY_UPSTREAM_POINTER = 'See [UPSTREAM.md]';
/** The only UPSTREAM.md body the tool ever wrote before the uniform line (migration marker). */
const LEGACY_UPSTREAM_TEXT = 'License and attribution files retained from source material';
/** Canonical tool-written CONTRIBUTIONS.md: every section carries the same single line. */
const CONTRIBUTIONS_RECORD = `# Contributions in this submission

## Independently implemented features

${CONTRIBUTIONS_LINE}

## Files authored or changed

${CONTRIBUTIONS_LINE}

## Verification performed

${CONTRIBUTIONS_LINE}

## Upstream-derived code retained

${CONTRIBUTIONS_LINE}
`;

function sanitizeText(text, permitted, file) {
  const replacements = [];
  let output = text;
  const flags = permitted.get(file) ?? new Set();
  if (flags.has('personal-data')) {
    output = output.replace(EMAIL, match => {
      if (isPlaceholderEmail(match)) return match;
      replacements.push({ kind: 'email', from: '[REDACTED_EMAIL]' });
      return 'maintainer@example.invalid';
    });
    // 电话样式数字串同样要能改掉——扫描报它，就必须有对应的脱敏动作。
    output = output.replace(newPhonePattern(), () => {
      replacements.push({ kind: 'phone', from: '[REDACTED_PHONE]' });
      return '[REDACTED_PHONE]';
    });
  }
  if (flags.has('environment-path')) {
    output = output.replace(ABSOLUTE_USER_PATH, () => {
      replacements.push({ kind: 'absolute-path', from: '[REDACTED_PATH]' });
      return '${PROJECT_ROOT}';
    });
  }
  output = output.replace(CREDENTIAL_URL, () => {
    throw new Error(`Credential-bearing URL remains in ${file}; remove it and re-audit`);
  });
  return { output, replacements };
}

function safeProjectName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 80 || /[\r\n<>]/.test(name)) throw new Error('Project name must be 1-80 characters without newlines or angle brackets');
  return name;
}

export async function prepareRun(runDir, options = {}) {
  if (!options.rightsReviewed || !options.contestRulesReviewed) {
    throw new Error('Preparation requires --rights-reviewed and --contest-rules-reviewed acknowledgements');
  }
  const projectName = safeProjectName(options.name);
  const root = path.resolve(runDir);
  const source = path.join(root, 'source');
  const work = path.resolve(options.output ?? path.join(root, 'work'));
  if (!inside(root, work) || work === source) throw new Error('Prepared work directory must be inside the run and differ from source');
  if (await exists(work)) {
    const { readdir } = await import('node:fs/promises');
    if ((await readdir(work)).length > 0) throw new Error(`Work directory is not empty: ${work}; use a fresh run or move it aside first`);
  }
  const audit = options.audit ?? await auditRun(root);
  if (audit.summary.status === 'blocked') throw new Error('Audit is blocked by secrets or unsafe repository entries; resolve them in source and re-audit');
  let review = { auditFingerprint: audit.fingerprint, decisions: [] };
  try { review = await readJson(path.join(root, 'evidence', 'review-decisions.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (review.auditFingerprint !== audit.fingerprint) throw new Error('Review decisions are stale; re-review the current audit findings');
  const decisions = new Map(review.decisions.map(item => [item.findingId, item]));
  const unresolved = audit.findings.filter(item => ['review', 'retain-attribution'].includes(item.disposition) && !decisions.has(item.id));
  if (unresolved.length) throw new Error(`Audit has ${unresolved.length} unresolved review finding(s): ${unresolved.map(item => item.id).join(', ')}`);
  const excludedFiles = new Set(review.decisions.filter(item => item.decision === 'exclude-file').map(item => item.file));
  const sanitizeByFile = new Map();
  for (const decision of review.decisions.filter(item => item.decision === 'sanitize')) {
    if (!sanitizeByFile.has(decision.file)) sanitizeByFile.set(decision.file, new Set());
    sanitizeByFile.get(decision.file).add(decision.category);
  }
  // 保留路径：报告/看板等被策略排除、但赛题验收要求的交付物。文本仍自动脱敏个人信息与本机路径，
  // 二进制（看板图片等）原样复制；密钥扫描在 verify 阶段照旧硬阻断。
  const keepPaths = normalizeKeepPaths(options.keepPaths);
  await ensureDir(work);
  const copied = [];
  const replacements = [];
  for (const item of audit.files) {
    // 人工决定排除的文件一律不进副本——密钥文件只有这一条出口，排除决定优先于保留路径。
    if (excludedFiles.has(item.path)) continue;
    const kept = isKeptPath(item.path, keepPaths);
    if (!kept && !['code', 'build', 'attribution', 'docs'].includes(item.kind)) continue;
    if (ALWAYS_GENERATED_FILES.has(item.path)) continue;
    const sourceFile = path.join(source, ...item.path.split('/'));
    const targetFile = path.join(work, ...item.path.split('/'));
    const stat = await lstat(sourceFile);
    if (!stat.isFile()) continue;
    await mkdir(path.dirname(targetFile), { recursive: true });
    const data = await readFile(sourceFile);
    if (data.includes(0)) {
      if (!kept) continue;
      await writeFile(targetFile, data, { mode: 0o600 });
      copied.push({ path: item.path, kind: item.kind, kept: true, binary: true, bytes: data.length, sourceSha256: item.contentSha256, preparedSha256: createHash('sha256').update(data).digest('hex') });
      continue;
    }
    let output = data.toString('utf8');
    if (kept || item.kind !== 'attribution') {
      const permitted = kept ? new Map([[item.path, new Set(['personal-data', 'environment-path'])]]) : sanitizeByFile;
      const sanitized = sanitizeText(output, permitted, item.path);
      output = sanitized.output;
      for (const replacement of sanitized.replacements) replacements.push({ file: item.path, ...replacement });
    }
    await writeFile(targetFile, output, { encoding: 'utf8', mode: 0o600 });
    copied.push({ path: item.path, kind: item.kind, ...(kept ? { kept: true } : {}), bytes: Buffer.byteLength(output), sourceSha256: item.contentSha256, preparedSha256: createHash('sha256').update(output).digest('hex') });
  }
  // Generated files are hashed as they are written so `diff` can later tell "tool wrote this"
  // apart from "the author edited it" (CONTRIBUTIONS.md is expected to be filled in).
  const generatedFiles = [];
  const writeGenerated = async (name, content, { onlyIfMissing = false } = {}) => {
    const target = path.join(work, name);
    // The upstream README is documentation like any other: keep it, and only write the tool's
    // transparent stub when the source had none.
    if (onlyIfMissing && await exists(target)) return;
    await writeFile(target, content, 'utf8');
    generatedFiles.push({ path: name, sha256: createHash('sha256').update(content).digest('hex') });
  };
  await writeGenerated('README.md', `# ${projectName}\n\nThis repository contains the executable source and build configuration for the project.\n\n## Original contributions\n\nDescribe the independently implemented competition functionality here.\n`, { onlyIfMissing: true });
  await writeGenerated('UPSTREAM.md', `${CONTRIBUTIONS_LINE}\n`);
  await writeGenerated('CONTRIBUTIONS.md', `# Contributions in this submission\n\n## Independently implemented features\n\nTODO: describe the behavior you designed and implemented.\n\n## Files authored or changed\n\nTODO: list paths and explain the changes.\n\n## Verification performed\n\nTODO: list tests and their observed results.\n\n## Upstream-derived code retained\n\n${CONTRIBUTIONS_LINE}\n`);
  await writeGenerated('.gitignore', GITIGNORE_TEMPLATE);
  const manifest = {
    schemaVersion: 1,
    preparedAt: new Date().toISOString(),
    sourceCommit: audit.source?.commit ?? null,
    copied,
    replacements,
    decisions: review.decisions,
    generated: generatedFiles,
    keepPaths,
    excluded: audit.files.filter(item => !isKeptPath(item.path, keepPaths) && (!['code', 'build', 'attribution', 'docs'].includes(item.kind) || excludedFiles.has(item.path))).map(item => ({ path: item.path, kind: item.kind, reason: item.reason })),
  };
  await writeJson(path.join(root, 'evidence', 'prepare.json'), manifest);
  await writeJson(path.join(work, '.contest-publisher-manifest.json'), { schemaVersion: 1, keepPaths, copied: manifest.copied.map(({ path, kind, preparedSha256 }) => ({ path, kind, preparedSha256 })) });
  return { workDir: work, manifest };
}

/** Keep `prepare.json`'s generated-file hash in sync after the tool rewrites the record itself. */
async function refreshGeneratedHash(root, relative, content) {
  const manifestPath = path.join(root, 'evidence', 'prepare.json');
  let manifest;
  try { manifest = await readJson(manifestPath); } catch { return; }
  const sha256 = createHash('sha256').update(content).digest('hex');
  const generated = Array.isArray(manifest.generated) ? manifest.generated.filter(item => item && typeof item === 'object') : [];
  const existing = generated.find(item => item.path === relative);
  if (existing) existing.sha256 = sha256;
  else generated.push({ path: relative, sha256 });
  manifest.generated = generated;
  await writeJson(manifestPath, manifest);
}

/**
 * Submission notices are written by the tool, not by hand: UPSTREAM.md and every
 * CONTRIBUTIONS.md section carry the same single line. A human-written file is never
 * overwritten; a prepare stub or a record from an older build is replaced, and repeating
 * the call is a no-op.
 */
export async function writeContributionRecord(runDir) {
  const root = path.resolve(runDir);
  const target = path.join(root, 'work', 'CONTRIBUTIONS.md');
  if (!(await exists(target))) return { written: false, reason: 'no work copy' };
  const current = await readFile(target, 'utf8');
  let written = false;
  let reason = 'already current';
  if (current !== CONTRIBUTIONS_RECORD) {
    const hasLine = current.includes(CONTRIBUTIONS_LINE);
    // Recognizably tool-derived: the prepare stub, an older build's wording, or an older
    // build's template (same heading + the line). Anything else is human prose and is kept.
    const toolWritten = current.includes(CONTRIBUTIONS_STUB_MARKER)
      || current.includes(LEGACY_UPSTREAM_POINTER)
      || current.includes('本仓库为上游仓库的直接搬运')
      || current.includes('由 contest-publisher 依据')
      || current.includes('静态验证由 contest-publisher')
      || current.includes('在搬运模式下完成静态验证')
      || (hasLine && current.includes('## Independently implemented features'));
    if (!toolWritten) reason = 'human content kept';
    else {
      await writeFile(target, CONTRIBUTIONS_RECORD, 'utf8');
      await refreshGeneratedHash(root, 'CONTRIBUTIONS.md', CONTRIBUTIONS_RECORD);
      written = true;
      reason = null;
    }
  }
  const upstreamWritten = await rewriteLegacyUpstream(root);
  if (!written && upstreamWritten) reason = 'upstream record refreshed';
  return { written: written || upstreamWritten, reason, line: CONTRIBUTIONS_LINE, upstreamWritten };
}

/** Brings an older build's UPSTREAM.md onto the uniform line; hand-written files are left alone. */
async function rewriteLegacyUpstream(root) {
  const target = path.join(root, 'work', 'UPSTREAM.md');
  if (!(await exists(target))) return false;
  const current = await readFile(target, 'utf8');
  if (current.trim() === CONTRIBUTIONS_LINE) return false;
  if (!current.includes(LEGACY_UPSTREAM_TEXT) && !current.includes(LEGACY_UPSTREAM_POINTER)) return false;
  await writeFile(target, `${CONTRIBUTIONS_LINE}\n`, 'utf8');
  await refreshGeneratedHash(root, 'UPSTREAM.md', await readFile(target, 'utf8'));
  return true;
}
