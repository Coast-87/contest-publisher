import path from 'node:path';
import { auditRun } from './audit.mjs';
import { readJson, writeJson } from './store.mjs';

function validateDecision(finding, decision) {
  if (finding.disposition === 'block') throw new Error('Blocking findings, including secrets, must be removed from source and re-audited');
  const allowed = new Set();
  // 密钥没有"确认放行"这一说：唯一合法处置是把该文件排除出副本（exclude-file），
  // 这样既能继续流程，又保证密钥不会进入提交内容。
  if (finding.category === 'secret') {
    allowed.add('exclude-file');
  }
  if (['personal-data', 'environment-path'].includes(finding.category)) {
    allowed.add('sanitize');
    allowed.add('exclude-file');
    allowed.add('false-positive');
  }
  if (finding.category === 'project-identity') {
    allowed.add('exclude-file');
    allowed.add('false-positive');
    allowed.add('retain-attribution');
  }
  if (finding.category === 'license') allowed.add('license-reviewed');
  if (finding.category === 'repository') {
    allowed.add('exclude-file');
    allowed.add('false-positive');
  }
  // Attribution files (LICENSE/NOTICE) are kept verbatim by policy, so a contact found in one is
  // reported as retain-attribution. Confirming that is the only honest answer: sanitize would
  // rewrite a legal notice and false-positive would record a false statement.
  if (finding.disposition === 'retain-attribution') allowed.add('retain-attribution');
  if (!allowed.has(decision)) throw new Error(`Decision '${decision}' is not allowed for ${finding.category}`);
  if (decision === 'exclude-file' && !finding.file) throw new Error('Finding has no file to exclude');
  if (decision === 'exclude-file' && ['license', 'attribution'].includes(finding.category)) throw new Error('License and attribution files cannot be excluded');
}

export async function reviewFinding(runDir, { findingId, decision, note }) {
  if (!findingId || !decision || !note?.trim()) throw new Error('findingId, decision, and a non-empty note are required');
  const root = path.resolve(runDir);
  const audit = await auditRun(root);
  const finding = audit.findings.find(item => item.id === findingId);
  if (!finding) throw new Error(`Finding not present in current audit: ${findingId}`);
  validateDecision(finding, decision);
  const file = path.join(root, 'evidence', 'review-decisions.json');
  let record = { schemaVersion: 1, auditFingerprint: audit.fingerprint, decisions: [] };
  try { record = await readJson(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (record.auditFingerprint !== audit.fingerprint) record = { schemaVersion: 1, auditFingerprint: audit.fingerprint, decisions: [] };
  record.decisions = record.decisions.filter(item => item.findingId !== findingId);
  record.decisions.push({ findingId, category: finding.category, file: finding.file, decision, note: note.trim(), reviewedAt: new Date().toISOString() });
  await writeJson(file, record);
  return { findingId, decision, auditFingerprint: audit.fingerprint };
}
