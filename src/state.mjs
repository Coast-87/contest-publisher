import path from 'node:path';
import { lstat, readdir, rm } from 'node:fs/promises';
import { exists, inside, readJson, writeJson } from './store.mjs';
import { repoNameFromLocal, repoNameFromUrl } from './acquire.mjs';

// Two verification policies:
//   strict  (default) — work/ must contain at least one code file that differs from the pinned
//                       source checkout (`no-original-code-delta`).
//   copy              — the run is a straight re-publish of the upstream repository: the delta
//                       rule is waived and recorded, every other gate stays in force.
export const RUN_MODES = ['strict', 'copy'];
const MODE_FILE = 'evidence/run-mode.json';

export async function readRunMode(runDir) {
  const record = await optionalJson(path.join(path.resolve(runDir), MODE_FILE));
  return RUN_MODES.includes(record?.mode) ? record.mode : 'strict';
}

export async function writeRunMode(runDir, mode, note = '') {
  if (!RUN_MODES.includes(mode)) throw new Error(`Unknown run mode: ${mode}（可选 ${RUN_MODES.join(' / ')}）`);
  const root = path.resolve(runDir);
  if (!(await exists(root))) throw new Error(`Run does not exist: ${root}`);
  await writeJson(path.join(root, MODE_FILE), {
    schemaVersion: 1,
    mode,
    note,
    setAt: new Date().toISOString(),
    consequence: mode === 'copy'
      ? '原创代码增量豁免：本运行按上游仓库直接搬运处理，其余门禁（凭证、语法、文档、贡献记录）仍然生效。'
      : '严格模式：work/ 必须存在相对固定 commit 的原创代码增量。',
  });
  return mode;
}

const STAGES = [
  ['CREATED', null],
  ['ACQUIRED', 'source.json'],
  ['AUDITED', 'evidence/audit.json'],
  ['PREPARED', 'evidence/prepare.json'],
  ['VERIFIED', 'evidence/verify.json'],
  ['REPOSITORY_CREATED', 'evidence/repository.json'],
  ['INITIALIZED', 'evidence/repository-init.json'],
  ['PUSHED', 'evidence/push.json'],
  ['PROBLEM_LOCKED', 'evidence/selected-problem.json'],
  ['SUBMITTED', 'evidence/submission.json'],
];

async function optionalJson(file) {
  try { return await readJson(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function statusRun(runDir) {
  const root = path.resolve(runDir);
  if (!(await exists(root))) throw new Error(`Run does not exist: ${root}`);
  const evidence = path.join(root, 'evidence');
  const audit = await optionalJson(path.join(evidence, 'audit.json'));
  const verify = await optionalJson(path.join(evidence, 'verify.json'));
  const review = await optionalJson(path.join(evidence, 'review-decisions.json'));
  const failure = await optionalJson(path.join(root, 'acquire-failure.json'));
  const source = await optionalJson(path.join(root, 'source.json'));
  let stage = 'CREATED';
  for (const [candidate, relative] of STAGES.slice(1)) {
    if (await exists(path.join(root, relative))) stage = candidate;
  }
  if (failure && stage === 'CREATED') stage = 'ACQUIRE_FAILED';
  if (audit?.summary?.status === 'blocked') stage = 'BLOCKED_AUDIT';
  if (verify?.status === 'blocked') stage = 'BLOCKED_VERIFY';
  return {
    runDir: root,
    runId: path.basename(root),
    stage,
    mode: await readRunMode(root),
    source,
    // 工作台用它在用户未指定仓库名时预填目标仓库名（Git 源跟随仓库名，本地源跟随代码包名）。
    suggestedRepoName: repoNameFromUrl(source?.sourceUrl ?? '') || repoNameFromLocal(source?.localName ?? ''),
    audit: audit ? { status: audit.summary.status, trackedFiles: audit.summary.trackedFiles, counts: audit.summary.counts } : null,
    // Already-decided findings so the workbench can stop listing them as needing action.
    reviewedFindings: (review?.decisions ?? []).map(item => item.findingId),
    verify: verify ? { status: verify.status, fileCount: verify.fileCount, codeDelta: verify.codeDelta?.length ?? 0 } : null,
    selectedProblem: await optionalJson(path.join(evidence, 'selected-problem.json')),
    repository: await optionalJson(path.join(evidence, 'repository.json')),
    submission: await optionalJson(path.join(evidence, 'submission.json')),
    judgement: await optionalJson(path.join(evidence, 'judgement.json')),
    failure,
  };
}

export async function listRuns(runsRoot = path.resolve('runs')) {
  const root = path.resolve(runsRoot);
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try { result.push(await statusRun(path.join(root, entry.name))); } catch { /* ignore incomplete non-run folders */ }
  }
  return result.sort((a, b) => b.runDir.localeCompare(a.runDir));
}

// A run is only deletable when it actually looks like one: it must carry run
// evidence, so a stray directory under the runs root can never be removed.
async function assertLooksLikeRun(runDir) {
  const stat = await lstat(runDir).catch(error => {
    if (error.code === 'ENOENT') throw new Error(`Run does not exist: ${runDir}`);
    throw error;
  });
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('运行目录必须是真实目录，不能是符号链接');
  for (const marker of ['source.json', 'acquire-failure.json', 'evidence', 'work']) {
    if (await exists(path.join(runDir, marker))) return;
  }
  throw new Error('拒绝删除：该目录不是 contest-publisher 运行实例（缺少 source.json / evidence / work）');
}

export async function deleteRun(runDir, { force = false, root } = {}) {
  const target = path.resolve(runDir);
  if (root) {
    const base = path.resolve(root);
    if (target === base || !inside(base, target)) throw new Error('Invalid run id');
  }
  await assertLooksLikeRun(target);
  if (!force) {
    const pushed = await exists(path.join(target, 'evidence', 'push.json'));
    if (!pushed && (await exists(path.join(target, 'work', '.git')))) {
      throw new Error('工作副本已初始化但尚未推送成功，删除会丢失改动；确认后使用强制删除');
    }
  }
  await rm(target, { recursive: true, force: true });
  return { deleted: true, runId: path.basename(target), runDir: target };
}
