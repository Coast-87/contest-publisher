import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { classifyPath, isKeptPath, normalizeKeepPaths, scanText } from './policy.mjs';
import { exists, readJson } from './store.mjs';
import { checkJsSyntax } from './process.mjs';

const GENERATED_FILES = new Set(['README.md', 'UPSTREAM.md', 'CONTRIBUTIONS.md', '.contest-publisher-manifest.json']);
// 工具自己的索引文件：内容是路径与哈希，扫它只会产生自伤误报。
const TOOL_OWNED_FILES = new Set(['.contest-publisher-manifest.json']);

// tsconfig 之类常带注释/尾逗号（JSONC），直接 JSON.parse 会把正常项目误判为非法 JSON。
function parseJsonLoose(text) {
  try { JSON.parse(text); return true; } catch {}
  const stripped = text
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, match => (match.startsWith('"') ? match : ''))
    .replace(/,(\s*[}\]])/g, '$1');
  try { JSON.parse(stripped); return true; } catch { return false; }
}

async function walk(root, relative = '') {
  const current = path.join(root, relative);
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, child));
    else if (entry.isFile()) files.push(child.split(path.sep).join('/'));
    else throw new Error(`Prepared work contains unsupported entry: ${child}`);
  }
  return files.sort();
}

export async function verifyPrepared(workDir, { runChecks = true, allowGit = false, allowCopy = false } = {}) {
  const root = path.resolve(workDir);
  if (!(await exists(root))) throw new Error(`Work directory does not exist: ${root}`);
  const markerPath = path.join(root, '.contest-publisher-manifest.json');
  if (!(await exists(markerPath))) throw new Error('Prepared work is missing .contest-publisher-manifest.json');
  for (const generated of ['README.md', 'UPSTREAM.md', 'CONTRIBUTIONS.md']) {
    if (!(await exists(path.join(root, generated)))) throw new Error(`Prepared work is missing ${generated}`);
  }
  const marker = await readJson(markerPath);
  const baseline = new Map((marker.copied ?? []).map(item => [item.path, item.preparedSha256]));
  // 保留路径下的文件（报告/看板等交付物）由运营显式声明，允许二进制与非白名单扩展名；
  // 密钥扫描、JSON 解析与文件白名单以外的一切安全门禁照旧。
  const keepPaths = normalizeKeepPaths(marker.keepPaths ?? []);
  const files = await walk(root);
  const findings = [];
  const syntaxChecked = [];
  const codeDelta = [];
  const currentKinds = new Map();
  for (const relative of files) {
    const classification = classifyPath(relative);
    const kept = isKeptPath(relative, keepPaths);
    if (classification.kind === 'exclude' && !GENERATED_FILES.has(relative) && !kept) {
      findings.push({ category: 'unexpected-file', file: relative, disposition: 'block' });
    }
    const file = path.join(root, ...relative.split('/'));
    const stat = await lstat(file);
    if (!stat.isFile()) {
      findings.push({ category: 'non-regular-file', file: relative, disposition: 'block' });
      continue;
    }
    if (stat.size > 5 * 1024 * 1024 && !kept) findings.push({ category: 'oversize', file: relative, disposition: 'review' });
    const buffer = await readFile(file);
    if (buffer.includes(0)) {
      if (!kept) findings.push({ category: 'binary', file: relative, disposition: 'block' });
      continue;
    }
    const text = buffer.toString('utf8');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    currentKinds.set(relative, classification.kind);
    if (classification.kind === 'code') {
      const original = baseline.get(relative);
      if (!original || original !== sha256) codeDelta.push({ path: relative, change: original ? 'modified' : 'added' });
    }
    for (const finding of TOOL_OWNED_FILES.has(relative) ? [] : scanText(relative, text)) {
      if (finding.category === 'secret') {
        findings.push({ ...finding, disposition: 'block' });
      } else if (classification.kind === 'attribution' || classification.kind === 'docs' || kept) {
        // Licenses stay verbatim; documentation may legitimately name its maintainers and is
        // already subject to a review decision (sanitize rewrote it at prepare time when asked).
      } else {
        findings.push({ ...finding, disposition: 'block' });
      }
    }
    if (runChecks && !kept && /\.(?:mjs|cjs|js)$/i.test(relative)) {
      checkJsSyntax(file, text);
      syntaxChecked.push(relative);
    }
    if (runChecks && /\.json$/i.test(relative) && !parseJsonLoose(text)) {
      findings.push({ category: 'invalid-json', file: relative, disposition: 'block' });
    }
  }
  // CONTRIBUTIONS.md is not a gate: the tool writes that record itself (see writeContributionRecord
  // in prepare.mjs). Verification only cares about security, syntax, whitelist and the delta rule.
  // In copy mode the run is an explicit, recorded re-publish of the upstream repository: the
  // delta rule becomes a waived finding instead of a blocker. Every other gate stays in force.
  if (codeDelta.length === 0) {
    findings.push({
      category: 'no-original-code-delta',
      disposition: allowCopy ? 'waived' : 'block',
      evidence: allowCopy
        ? '搬运模式（copy）已豁免：本运行按上游仓库直接搬运处理，豁免记录见 evidence/run-mode.json'
        : 'work/ 与固定 commit 的源快照一致，缺少原创代码增量',
    });
  }
  const blocking = findings.filter(item => item.disposition === 'block');
  const reviewable = findings.filter(item => item.disposition !== 'block' && item.disposition !== 'waived');
  return {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    workDir: root,
    mode: allowCopy ? 'copy' : 'strict',
    fileCount: files.length,
    syntaxChecked,
    codeDelta,
    findings,
    status: blocking.length ? 'blocked' : reviewable.length ? 'review_required' : 'passed',
  };
}
