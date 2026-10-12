import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { exists, writeJson } from './store.mjs';
import { runNode } from './process.mjs';

// STS 有效期只有 900 秒：api.mjs 已带 --auto-refresh 原地刷新并重试一次；
// 仍 401 说明无 _refresh 元数据或刷新失败，给出可操作提示而不是裸 JSON。
function mapIctError(error) {
  const message = String(error.message ?? error);
  if (/GALLERY\.AUTH\.UNAUTHORIZED/.test(message)) {
    return new Error('STS 凭证无效或已过期（有效期 900 秒），自动刷新未成功：请在 ⚙ 配置 重新生成 STS 凭证（需 hcloud 与华为云账号 ID），或检查凭证文件是否含 _refresh 元数据');
  }
  if (/#none/.test(message)) return new Error('平台当前没有可用的 AI 赛题（#none）');
  if (/SUBMISSION_NOT_FOUND|#status=404/.test(message)) return new Error('未找到该提交记录：只能查询本人提交，或 submissionId 不正确');
  return error;
}

function invoke(script, args) {
  try {
    return runNode(script, args, { timeout: 60_000 });
  } catch (error) {
    throw mapIctError(error);
  }
}

// 赛题列表（只读）：解析 list-problems.mjs 的 #problem 行，供工作台展示并选择目标。
// 列表行格式: #problem <n> <name> [window=<起>~<止>] [status=<状态>]（name 可含空格，故 window/status 从尾部锚定）。
export async function listCompetitionProblems({ skillDir, creds }) {
  if (!creds || typeof creds !== 'string' || !creds.trim()) throw new Error('缺少 STS 凭证文件路径：请在 ⚙ 配置 里填写或点「生成」自动生成 STS 凭证');
  if (!skillDir || typeof skillDir !== 'string' || !skillDir.trim()) throw new Error('缺少 ICT Skill 目录：请在 ⚙ 配置 或环境自检里确认内置 Skill');
  const listScript = path.join(path.resolve(skillDir), 'scripts', 'list-problems.mjs');
  if (!(await exists(listScript))) throw new Error(`ICT skill script not found: ${listScript}`);
  let output;
  try {
    output = runNode(listScript, ['--creds-file', path.resolve(creds)], { timeout: 60_000 });
  } catch (error) {
    throw mapIctError(error);
  }
  const statusLine = output.split('\n')[0]?.trim() ?? '';
  if (!statusLine.includes('200')) throw new Error(`ICT API returned ${statusLine || '（无响应）'}`);
  const items = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^#problem (\d+) (.+?)(?:\s+window=(\S+))?(?:\s+status=(\S+))?$/);
    if (match) items.push({ number: Number(match[1]), name: match[2], window: match[3] ?? null, status: match[4] ?? null });
  }
  if (!items.length) throw new Error('ICT 平台未返回任何赛题（列表为空）');
  return { ok: true, fetchedAt: new Date().toISOString(), items };
}

function parseApiOutput(raw) {
  const index = raw.indexOf('\n');
  if (index < 0) throw new Error('ICT API output did not contain a status line');
  const status = raw.slice(0, index).trim();
  let body;
  try { body = JSON.parse(raw.slice(index + 1)); } catch { throw new Error('ICT API returned invalid JSON'); }
  if (!status.includes('200')) throw new Error(`ICT API returned ${status}`);
  return body;
}

// A2 查询提交状态（只读）：判题结果由平台异步回传，这里把 judgeStatus / failureReason 取回来，
// 失败原因会展示给提交人，是"为什么没通过"的唯一权威来源。
export async function fetchSubmissionStatus({ skillDir, creds, submissionId }) {
  if (!creds || typeof creds !== 'string' || !creds.trim()) throw new Error('缺少 STS 凭证文件路径：请在 ⚙ 配置 里填写或点「生成」自动生成 STS 凭证');
  if (!skillDir || typeof skillDir !== 'string' || !skillDir.trim()) throw new Error('缺少 ICT Skill 目录：请在 ⚙ 配置 或环境自检里确认内置 Skill');
  if (!submissionId || typeof submissionId !== 'string' || !submissionId.trim()) throw new Error('缺少 submissionId：提交成功后 evidence/submission.json 会记录它');
  const apiScript = path.join(path.resolve(skillDir), 'scripts', 'api.mjs');
  if (!(await exists(apiScript))) throw new Error(`ICT skill script not found: ${apiScript}`);
  let output;
  try {
    // 路径不带前缀：api.mjs 会自动补 open-api-public。
    output = runNode(apiScript, ['GET', `/v1/gallery/competition/submissions/${submissionId.trim()}`, '--creds-file', path.resolve(creds), '--auto-refresh'], { timeout: 60_000 });
  } catch (error) {
    throw mapIctError(error);
  }
  const body = parseApiOutput(output);
  const submission = body?.data?.submission;
  if (!submission) throw new Error('ICT API 响应缺少 submission 字段');
  return { fetchedAt: new Date().toISOString(), ...submission };
}

export async function selectCompetitionProblem({ runDir, skillDir, number, creds }) {
  if (!Number.isInteger(Number(number)) || Number(number) < 1) throw new Error('请提供有效的赛题序号（从 1 开始的整数）');
  if (!creds || typeof creds !== 'string' || !creds.trim()) throw new Error('缺少 STS 凭证文件路径：请在 ⚙ 配置 里填写或点「生成」自动生成 STS 凭证');
  if (!skillDir || typeof skillDir !== 'string' || !skillDir.trim()) throw new Error('缺少 ICT Skill 目录：请在 ⚙ 配置 或环境自检里确认内置 Skill');
  const root = path.resolve(runDir);
  const scripts = path.join(path.resolve(skillDir), 'scripts');
  const listScript = path.join(scripts, 'list-problems.mjs');
  const apiScript = path.join(scripts, 'api.mjs');
  for (const file of [listScript, apiScript]) if (!(await exists(file))) throw new Error(`ICT skill script not found: ${file}`);
  const lockFile = path.join(root, 'evidence', '.ict-target.json');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(lockFile), { recursive: true });
  const selectionOutput = invoke(listScript, ['--select', String(number), '--creds-file', path.resolve(creds), '--lock-file', lockFile]);
  const selectedLine = selectionOutput.split('\n').find(line => line.startsWith('#selected '));
  if (!selectedLine) throw new Error(`ICT selection did not return #selected: ${selectionOutput.trim()}`);
  const nameMatch = selectedLine.match(/\bname=(.*)$/);
  const problemId = selectedLine.match(/\bproblemId=([^ ]+)/)?.[1];
  const trainingCampId = selectedLine.match(/\btrainingCampId=([^ ]+)/)?.[1];
  const selectedNumber = Number(selectedLine.match(/\bnumber=(\d+)/)?.[1]);
  const problemName = nameMatch?.[1]?.trim();
  if (!problemId || !trainingCampId || !problemName || !selectedNumber) throw new Error(`Malformed #selected line: ${selectedLine}`);
  const apiOutput = invoke(apiScript, ['GET', '/v1/gallery/competition/camps', '--query', `problemId=${encodeURIComponent(problemId)}`, '--creds-file', path.resolve(creds), '--auto-refresh']);
  const body = parseApiOutput(apiOutput);
  const item = body?.data?.items?.[0] ?? body?.data ?? null;
  if (!item || item.problemId !== problemId || item.trainingCampId !== trainingCampId || item.name?.trim() !== problemName) throw new Error('A0 problem details do not match the selected problem lock');
  if (!item.startsAt || !item.endsAt) throw new Error('Selected problem response lacks startsAt/endsAt; cannot validate competition window');
  const selection = {
    schemaVersion: 1,
    selectedAt: new Date().toISOString(),
    number: selectedNumber,
    problemId,
    trainingCampId,
    problemName,
    windowStart: item.startsAt,
    windowEnd: item.endsAt,
    status: item.status ?? null,
    lockFile,
  };
  await writeJson(path.join(root, 'evidence', 'selected-problem.json'), selection);
  // Verify the skill wrote the run-scoped target lock and it matches the selected record.
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  if (lock.problemId !== problemId || lock.trainingCampId !== trainingCampId || lock.name?.trim() !== problemName) throw new Error('ICT target lock does not match the selected problem');
  return selection;
}
