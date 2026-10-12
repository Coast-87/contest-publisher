import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists, writeJson } from './store.mjs';
import { runGit, runNode, resolveScriptRuntime } from './process.mjs';

function execNode(script, args, { execute = true } = {}) {
  const { command, env } = resolveScriptRuntime();
  const prefix = env.BUN_BE_BUN ? 'BUN_BE_BUN=1 ' : '';
  const commandLine = `${prefix}${command} ${[script, ...args].map(arg => JSON.stringify(arg)).join(' ')}`;
  if (!execute) return { command: commandLine, stdout: '' };
  return { command: commandLine, stdout: runNode(script, args, { timeout: 300_000 }) };
}

function parseLine(output, prefix) {
  const line = output.split('\n').find(item => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : null;
}

// extract-workname.mjs prints `#name=<name> source=<来源>`; the source marker is metadata,
// not part of the name — leaving it in pushes a ≤30-char name over the platform limit.
export function parseWorkName(output) {
  const line = output.split('\n').find(item => item.startsWith('#name='));
  if (!line) return null;
  return line.slice('#name='.length).replace(/\s+source=\S+\s*$/, '').trim() || null;
}

// submit-ict-work.mjs 的 201 输出是 `key=value` 行（submissionId/attemptNo/judgeStatus/workId/workUrl），
// 结构化下来供工作台展示判题状态与后续 A2 查询。
export function parseSubmitOutput(output) {
  const fields = {};
  for (const line of String(output ?? '').split('\n')) {
    const match = line.match(/^(submissionId|problemId|attemptNo|judgeStatus|workId|workUrl)=(.+)$/);
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}

export async function buildSubmitPlan({ workDir, skillDir, problemId, trainingCampId, problemName, windowStart, windowEnd, creds, targetLock, domainId, execute = false, evidenceDir }) {
  const root = path.resolve(workDir);
  const skill = path.resolve(skillDir);
  const scripts = path.join(skill, 'scripts');
  for (const file of ['check-ict-git-repo.mjs', 'read-git-info.mjs', 'extract-workname.mjs', 'build-submit-params.mjs', 'submit-ict-work.mjs']) {
    if (!(await exists(path.join(scripts, file)))) throw new Error(`ICT skill script not found: ${path.join(scripts, file)}`);
  }
  if (!problemId || !trainingCampId || !problemName || !windowStart || !windowEnd || !creds || !targetLock) throw new Error('problemId, trainingCampId, problemName, windowStart, windowEnd, creds, and targetLock are required');
  const lock = JSON.parse(await (await import('node:fs/promises')).readFile(targetLock, 'utf8'));
  if (lock.problemId !== problemId || lock.trainingCampId !== trainingCampId || String(lock.name).trim() !== problemName.trim()) throw new Error('ICT target lock does not match requested problem; select the problem through the ICT Skill first');
  const commands = [];
  const version = execNode(path.join(scripts, 'check-version.mjs'), [], { execute });
  commands.push(version.command);
  if (execute && !/status=(?:ok|skip)/.test(version.stdout.split('\n')[0] ?? '')) throw new Error('ICT Skill version check did not pass');
  const windowCheck = execNode(path.join(scripts, 'check-competition-window.mjs'), ['--start', windowStart, '--end', windowEnd], { execute });
  commands.push(windowCheck.command);
  if (execute && !windowCheck.stdout.includes('#window=open')) throw new Error('Competition window is not open; stopping before submission');
  const check = execNode(path.join(scripts, 'check-ict-git-repo.mjs'), [root], { execute });
  commands.push(check.command);
  if (execute && !check.stdout.split('\n').some(line => line.includes('#allowed=1'))) throw new Error('ICT A3 repository precheck did not return #allowed=1; stop before submission');
  const gitInfo = execute ? execNode(path.join(scripts, 'read-git-info.mjs'), [root]) : null;
  const workNameResult = execute ? execNode(path.join(scripts, 'extract-workname.mjs'), [root]) : null;
  let gitUrl = execute ? parseLine(gitInfo.stdout, '#gitUrl=') : runGit(['-C', root, 'remote', 'get-url', 'origin']).trim();
  let gitBranch = execute ? parseLine(gitInfo.stdout, '#gitBranch=') : runGit(['-C', root, 'branch', '--show-current']).trim() || 'main';
  let workName = execute ? parseWorkName(workNameResult.stdout) : path.basename(root);
  if (!gitUrl || !gitBranch || !workName) throw new Error('Unable to resolve gitUrl, gitBranch, or workName');
  const out = path.resolve(evidenceDir ?? path.join(path.dirname(root), 'evidence'), 'submit-params.json');
  const buildArgs = [path.join(scripts, 'build-submit-params.mjs'), '--out', out, '--problem-id', problemId, '--training-camp', trainingCampId, '--problem-name', problemName, '--work-name', workName, '--git-url', gitUrl, '--git-branch', gitBranch, '--creds', path.resolve(creds), '--lock-file', path.resolve(targetLock)];
  if (domainId) buildArgs.push('--domain-id', domainId);
  const built = execNode(buildArgs[0], buildArgs.slice(1), { execute });
  commands.push(built.command);
  const params = { out, problemId, trainingCampId, problemName, windowStart, windowEnd, targetLock: path.resolve(targetLock), workName, gitUrl, gitBranch, commands };
  if (execute) {
    const submission = execNode(path.join(scripts, 'submit-ict-work.mjs'), [out], { execute: true });
    commands.push(submission.command);
    params.submissionOutput = submission.stdout;
  }
  await writeJson(path.join(path.dirname(out), 'submit-plan.json'), params);
  return params;
}
