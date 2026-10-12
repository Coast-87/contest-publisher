import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { classifyPath, normalizeRelativePath, scanText, summarizeFindings } from './policy.mjs';
import { runGit } from './process.mjs';
import { exists, readJson, writeJson } from './store.mjs';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function getRunPaths(runDir) {
  const root = path.resolve(runDir);
  const source = path.join(root, 'source');
  if (!(await exists(source))) throw new Error(`Run has no source checkout: ${source}`);
  const sourceMeta = await exists(path.join(root, 'source.json')) ? await readJson(path.join(root, 'source.json')) : { sourceDir: source, sourceUrl: null, commit: null };
  return { root, source, sourceMeta };
}

function parseIndex(raw) {
  return raw.split('\0').filter(Boolean).map(record => {
    const separator = record.indexOf('\t');
    if (separator < 0) throw new Error('Unable to parse git index entry');
    const [mode, hash, stage] = record.slice(0, separator).split(' ');
    return { mode, hash, stage: Number(stage), path: normalizeRelativePath(record.slice(separator + 1)) };
  });
}

export async function auditRun(runDir) {
  const { root, source, sourceMeta } = await getRunPaths(runDir);
  const dirty = runGit(['-C', source, 'status', '--porcelain=v1', '--untracked-files=all']).trim();
  if (dirty) throw new Error('Source checkout changed after acquisition; restore it to the pinned commit before audit');
  const index = parseIndex(runGit(['-C', source, 'ls-files', '--stage', '-z']));
  const files = [];
  const findings = [];
  const licenses = [];
  for (const entry of index) {
    if (entry.stage !== 0) {
      findings.push({ id: `git-index:${entry.path}`, category: 'repository', file: entry.path, pattern: 'unmerged-index', disposition: 'block' });
      continue;
    }
    if (entry.mode === '160000') {
      findings.push({ id: `git-submodule:${entry.path}`, category: 'repository', file: entry.path, pattern: 'submodule-not-included', disposition: 'block' });
      files.push({ path: entry.path, kind: 'exclude', reason: 'submodule; review and acquire separately' });
      continue;
    }
    if (entry.mode === '120000') {
      findings.push({ id: `git-symlink:${entry.path}`, category: 'repository', file: entry.path, pattern: 'symlink-not-followed', disposition: 'block' });
      files.push({ path: entry.path, kind: 'exclude', reason: 'symlink requires review' });
      continue;
    }
    const classification = classifyPath(entry.path);
    const target = path.join(source, ...entry.path.split('/'));
    const stat = await lstat(target);
    if (!stat.isFile()) {
      findings.push({ id: `non-regular:${entry.path}`, category: 'repository', file: entry.path, pattern: 'non-regular-file', disposition: 'block' });
      files.push({ path: entry.path, kind: 'exclude', reason: 'not a regular file' });
      continue;
    }
    if (classification.kind === 'attribution') licenses.push(entry.path);
    if (stat.size > MAX_FILE_BYTES) {
      files.push({ path: entry.path, kind: classification.kind, reason: classification.reason, bytes: stat.size, gitBlobSha1: entry.hash, contentSha256: null });
      findings.push({ id: `oversize:${entry.path}`, category: 'repository', file: entry.path, pattern: 'file-exceeds-5MiB', disposition: 'review' });
      continue;
    }
    const buffer = await readFile(target);
    const contentSha256 = createHash('sha256').update(buffer).digest('hex');
    files.push({ path: entry.path, kind: classification.kind, reason: classification.reason, bytes: stat.size, gitBlobSha1: entry.hash, contentSha256 });
    if (buffer.includes(0)) {
      if (classification.kind !== 'exclude') {
        findings.push({ id: `binary:${entry.path}`, category: 'repository', file: entry.path, pattern: 'binary-not-in-code-only-copy', disposition: 'review' });
        files.at(-1).kind = 'exclude';
        files.at(-1).reason = 'binary content';
      }
      continue;
    }
    const text = buffer.toString('utf8');
    const scanned = scanText(entry.path, text);
    for (const finding of scanned) {
      // Excluded reports/data never enter work/, so their non-secret identities are recorded
      // as policy exclusions rather than requiring one manual decision per upstream record.
      // Secrets always need an explicit decision (the only legal one is excluding the file).
      if (classification.kind === 'exclude' && finding.disposition !== 'block' && finding.category !== 'secret') {
        finding.disposition = 'exclude-by-policy';
      }
      // Attribution files are intentionally retained. Report contacts in them for transparency,
      // but don't force deletion of legal notices or authorship records.
      if (classification.kind === 'attribution' && ['personal-data', 'project-identity'].includes(finding.category)) {
        finding.disposition = 'retain-attribution';
      }
      findings.push(finding);
    }
  }
  if (licenses.length === 0) findings.push({ id: 'license:missing', category: 'license', file: null, pattern: 'no-license-or-notice-found', disposition: 'review' });
  const summary = summarizeFindings(findings);
  const fingerprint = createHash('sha256').update(JSON.stringify({ source: sourceMeta.commit ?? null, files: files.map(({ path, contentSha256, kind }) => ({ path, contentSha256, kind })) })).digest('hex');
  if (findings.some(item => item.category === 'license')) summary.status = summary.status === 'blocked' ? 'blocked' : 'review_required';
  const result = {
    schemaVersion: 1,
    source: sourceMeta,
    auditedAt: new Date().toISOString(),
    fingerprint,
    summary: { ...summary, trackedFiles: index.length, filesByKind: Object.fromEntries(['code', 'build', 'attribution', 'review', 'exclude'].map(kind => [kind, files.filter(item => item.kind === kind).length])) },
    files,
    findings,
  };
  await writeJson(path.join(root, 'evidence', 'audit.json'), result);
  return result;
}
