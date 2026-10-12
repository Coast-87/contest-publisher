import path from 'node:path';
import { existsSync } from 'node:fs';
import { exists } from './store.mjs';
import { runGit } from './process.mjs';

export function validateCloneUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Remote URL must be a valid HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Remote URL must be credential-free HTTPS without query or fragment');
  }
  if (!url.pathname.endsWith('.git')) throw new Error('Remote URL must end with .git');
  return url.toString();
}

export function initPreparedRepo(workDir, { remote, authorName, authorEmail, message = 'Initialize prepared contest project' } = {}) {
  const safeRemote = validateCloneUrl(remote);
  if (!existsSync(path.join(workDir, '.contest-publisher-manifest.json')) || !['README.md', 'UPSTREAM.md', 'CONTRIBUTIONS.md'].every(name => existsSync(path.join(workDir, name)))) throw new Error('Work directory is not a prepared contest project');
  // Resolve author identity: explicit args > global git config
  let name = authorName?.trim();
  let email = authorEmail?.trim();
  if (!name) { try { name = runGit(['config', '--global', 'user.name']).trim(); } catch {} }
  if (!email) { try { email = runGit(['config', '--global', 'user.email']).trim(); } catch {} }
  if (!name) throw new Error('未提供提交作者名，且全局 git config 未配置 user.name');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`提交邮箱格式无效: ${email}`);
  runGit(['-C', workDir, 'init', '-q']);
  runGit(['-C', workDir, 'config', 'user.name', name]);
  if (email) runGit(['-C', workDir, 'config', 'user.email', email]);
  runGit(['-C', workDir, 'add', '-A']);
  const staged = runGit(['-C', workDir, 'diff', '--cached', '--name-only']).trim();
  if (!staged) throw new Error('Prepared work contains no files');
  // 行尾空白只是提示，不是门禁：提交的是作者自己的代码，源文件里有尾空格就卡死整条提交流程没有道理。
  // 结果里带上告警清单，界面能看到，但不阻断初始化与推送。
  let whitespace = [];
  try { runGit(['-C', workDir, 'diff', '--cached', '--check']); }
  catch (error) {
    whitespace = String(error.message).split('\n')
      .map(line => line.replace(/^.*exited \d+: /, '').trim())
      .filter(line => /whitespace|space before tab/.test(line))
      .slice(0, 20);
  }
  runGit(['-C', workDir, 'commit', '-qm', message]);
  runGit(['-C', workDir, 'branch', '-M', 'main']);
  runGit(['-C', workDir, 'remote', 'add', 'origin', safeRemote]);
  return { remote: safeRemote, branch: 'main', commit: runGit(['-C', workDir, 'rev-parse', 'HEAD']).trim(), stagedFiles: staged.split('\n'), ...(whitespace.length ? { whitespace } : {}) };
}

export function pushPreparedRepo(workDir, { remote, branch = 'main', execute = false, authorName, authorEmail } = {}) {
  const safeRemote = validateCloneUrl(remote ?? runGit(['-C', workDir, 'remote', 'get-url', 'origin']).trim());
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-')) throw new Error('Invalid branch name');
  const command = ['push', '--set-upstream', safeRemote, `HEAD:${branch}`];
  if (!execute) return { dryRun: true, remote: safeRemote, branch, command: `git ${command.join(' ')}` };
  const sync = reconcileRemoteHistory(workDir, safeRemote, branch, { authorName, authorEmail });
  runGit(['-C', workDir, 'push', '--set-upstream', safeRemote, `HEAD:${branch}`], { timeout: 300_000, secure: false });
  return { dryRun: false, remote: safeRemote, branch, commit: runGit(['-C', workDir, 'rev-parse', 'HEAD']).trim(), ...(sync ? { syncedWithRemote: sync } : {}) };
}

// 目标仓库已经有内容（例如上一次提交准备的副本）时，直接推会被 non-fast-forward 拒绝。
// 先把远端历史取回：远端是本地祖先 → 直接推；两端分叉或本地落后 → 以远端为基线，
// 把本次工作副本整体记成一个新提交（保留远端历史，HEAD 与工作副本一致）。
export function reconcileRemoteHistory(workDir, remote, branch, { authorName, authorEmail } = {}) {
  try {
    runGit(['-C', workDir, 'fetch', '--quiet', remote, branch], { timeout: 300_000, secure: false });
  } catch {
    return null; // 空仓库或分支不存在 → 直接推送
  }
  const remoteHead = runGit(['-C', workDir, 'rev-parse', 'FETCH_HEAD']).trim();
  const localHead = runGit(['-C', workDir, 'rev-parse', 'HEAD']).trim();
  if (remoteHead === localHead) return { remoteHead, replay: false };
  try {
    runGit(['-C', workDir, 'merge-base', '--is-ancestor', remoteHead, localHead]);
    return { remoteHead, replay: false }; // 远端已在本地历史里，可 fast-forward
  } catch { /* 分叉或落后，走 replay */ }
  runGit(['-C', workDir, 'reset', '--soft', remoteHead], { secure: false });
  runGit(['-C', workDir, 'add', '-A'], { secure: false });
  if (runGit(['-C', workDir, 'status', '--porcelain'], { secure: false }).trim()) {
    const identity = [];
    if (authorName?.trim()) identity.push('-c', `user.name=${authorName.trim()}`);
    if (authorEmail?.trim()) identity.push('-c', `user.email=${authorEmail.trim()}`);
    runGit(['-C', workDir, ...identity, 'commit', '-qm', 'Update prepared contest project'], { secure: false });
  }
  return { remoteHead, replay: true };
}

