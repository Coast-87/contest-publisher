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

// 推送凭证：GitCode 的 HTTPS 认证要「用户名 + 私人令牌」，这跟建仓走的 REST API 是两条
// 互不相通的通道——令牌存在本机配置里，git 读不到它，于是在没有终端的进程里直接报
// "could not read Username ... Device not configured"（实测：推送端点匿名 401，带令牌 200）。
// 这里把令牌通过环境变量交给 git，由一次性 credential.helper 现场读出：
//   · 不拼进 URL（validateCloneUrl 本来就禁止带凭证的 URL）
//   · 不落盘（helper 是命令行里的一段函数，不是脚本文件）
//   · 不进命令行（异常信息会原样带上整条命令，所以命令行里只出现变量名）
//   · 不进系统凭证存储（先把 helper 列表清空，只留这一个，git 就不会把令牌交给钥匙串）
// 用户名必须非空，否则 git 会转而提示输入用户名——那正是无终端时失败的原因；
// 具体填什么 GitCode 不做校验（实测错误用户名 + 正确令牌同样通过），所以按 URL 里的
// 归属者填即可，仓库在层级分组下也退化为「非空但可能不准」，不影响认证。
export const GIT_TOKEN_ENV = 'CONTEST_PUBLISHER_GIT_TOKEN';

export function gitPushCredentialArgs(remote, { token, username } = {}) {
  if (!token) return null;
  let url;
  try { url = new URL(remote); } catch { return null; }
  if (url.protocol !== 'https:') return null; // ssh 之类交给系统凭证，别把令牌递到别的通道
  const user = String(username ?? '').trim() || url.pathname.split('/').filter(Boolean)[0] || '';
  if (!/^[A-Za-z0-9._-]+$/.test(user)) return null;
  return {
    args: ['-c', 'credential.helper=', '-c', `credential.${url.origin}.helper=!f() { echo username=${user}; echo password="$${GIT_TOKEN_ENV}"; }; f`],
    env: { [GIT_TOKEN_ENV]: token },
  };
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

export function pushPreparedRepo(workDir, { remote, branch = 'main', execute = false, authorName, authorEmail, token, username } = {}) {
  const safeRemote = validateCloneUrl(remote ?? runGit(['-C', workDir, 'remote', 'get-url', 'origin']).trim());
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-')) throw new Error('Invalid branch name');
  const auth = gitPushCredentialArgs(safeRemote, { token, username });
  const argv = [...(auth?.args ?? []), 'push', '--set-upstream', safeRemote, `HEAD:${branch}`];
  if (!execute) return { dryRun: true, remote: safeRemote, branch, command: `git ${argv.join(' ')}`, ...(auth ? { credential: 'token' } : {}) };
  const sync = reconcileRemoteHistory(workDir, safeRemote, branch, { authorName, authorEmail, auth });
  try {
    runGit(['-C', workDir, ...argv], { timeout: 300_000, secure: false, env: auth?.env });
  } catch (error) {
    // 令牌只从环境变量读，正常不会出现在 git 的输出里；万一出现也不能带进日志和证据文件。
    throw new Error(auth ? String(error.message).replaceAll(token, '[REDACTED]') : error.message);
  }
  return { dryRun: false, remote: safeRemote, branch, commit: runGit(['-C', workDir, 'rev-parse', 'HEAD']).trim(), ...(sync ? { syncedWithRemote: sync } : {}), ...(auth ? { credential: 'token' } : {}) };
}

// 目标仓库已经有内容（例如上一次提交准备的副本）时，直接推会被 non-fast-forward 拒绝。
// 先把远端历史取回：远端是本地祖先 → 直接推；两端分叉或本地落后 → 以远端为基线，
// 把本次工作副本整体记成一个新提交（保留远端历史，HEAD 与工作副本一致）。
// fetch 与 push 同样要过认证，凭证参数整组透传；后面几步是本地操作，用不上。
export function reconcileRemoteHistory(workDir, remote, branch, { authorName, authorEmail, auth } = {}) {
  try {
    runGit(['-C', workDir, ...(auth?.args ?? []), 'fetch', '--quiet', remote, branch], { timeout: 300_000, secure: false, env: auth?.env });
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

