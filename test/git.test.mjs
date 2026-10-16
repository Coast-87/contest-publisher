import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { gitPushCredentialArgs, initPreparedRepo, pushPreparedRepo, reconcileRemoteHistory, validateCloneUrl } from '../src/git.mjs';
import { runGit } from '../src/process.mjs';

test('rejects credential-bearing target remotes', () => {
  assert.throws(() => validateCloneUrl('https://user:token@gitcode.com/a/b.git'), /credential-free/);
  assert.throws(() => validateCloneUrl('https://gitcode.com/a/b'), /end with \.git/);
});

// 真实事故：配置里填了 GitCode 令牌也确认没过期，推送仍然报
// "could not read Username for 'https://gitcode.com': Device not configured"——因为令牌
// 只进 REST API，而推送走 git 自己的凭证通道。令牌必须现场交给 git，且不能出现在
// 命令行里（异常信息会原样带上整条命令）。
test('push hands the token to git through a one-shot helper, never the command line', () => {
  const remote = 'https://gitcode.com/coastt/trip-planner.git';
  const token = 'tok-test-abcdefghijklmnop';
  // execute:false 只生成计划，不读工作目录，所以给一个不存在的目录也安全。
  const dry = pushPreparedRepo(path.join(os.tmpdir(), 'contest-git-absent'), { remote, execute: false, token });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.credential, 'token');
  assert.equal(dry.command.includes(token), false, '命令行里不能出现令牌');
  assert.match(dry.command, /credential\.helper=/, '凭证经 helper 传递');

  const { args, env } = gitPushCredentialArgs(remote, { token });
  assert.equal(args[1], 'credential.helper=', '先清空 helper 列表：系统凭证不能抢先，令牌也不会被写进钥匙串');
  // 真的问一次 git：能不能拿到凭证（这一步就是推送前 git 自己做的事）。
  const out = execFileSync('git', [...args, 'credential', 'fill'], {
    input: 'protocol=https\nhost=gitcode.com\n\n',
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.match(out, /^username=coastt$/m);
  assert.match(out, new RegExp(`^password=${token}$`, 'm'));

  // 没给令牌时就保持原样：交给系统凭证，不引入任何额外参数。
  const plain = pushPreparedRepo(path.join(os.tmpdir(), 'contest-git-absent'), { remote, execute: false });
  assert.equal(plain.credential, undefined);
  assert.equal(plain.command.includes('credential'), false);
});

test('token plumbing only applies to https remotes', () => {
  const token = 'tok-test-abcdefghijklmnop';
  assert.equal(gitPushCredentialArgs('git@gitcode.com:coastt/trip-planner.git', { token }), null);
  assert.equal(gitPushCredentialArgs('http://gitcode.com/coastt/trip-planner.git', { token }), null);
  assert.equal(gitPushCredentialArgs('https://gitcode.com/coastt/trip-planner.git', {}), null);
});

test('initializes a prepared copy with an explicit author identity and clean remote', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contest-git-'));
  try {
    await mkdir(root, { recursive: true });
    for (const file of ['.contest-publisher-manifest.json', 'README.md', 'UPSTREAM.md', 'CONTRIBUTIONS.md']) await writeFile(path.join(root, file), '{}\n');
    const result = initPreparedRepo(root, { remote: 'https://gitcode.com/me/project.git', authorName: 'Contest Author', authorEmail: 'author@example.invalid' });
    assert.equal(result.branch, 'main');
    assert.equal(result.remote, 'https://gitcode.com/me/project.git');
    assert.equal((await readFile(path.join(root, '.git', 'config'), 'utf8')).includes('https://gitcode.com/me/project.git'), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// 目标仓库已有内容时（上一次准备的副本），推送必须仍然成功：以远端为基线把新副本记成新提交。
test('re-publishing onto a remote that already has history replays the work copy as a new commit', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'contest-git-'));
  const remote = path.join(tmp, 'remote.git');
  try {
    runGit(['init', '--bare', '-q', remote]);
    // 第一份副本：远端已有历史
    const first = path.join(tmp, 'first');
    await mkdir(first, { recursive: true });
    for (const name of ['README.md', 'UPSTREAM.md', 'CONTRIBUTIONS.md']) await writeFile(path.join(first, name), 'first\n');
    runGit(['-C', first, 'init', '-q']);
    runGit(['-C', first, 'add', '-A']);
    runGit(['-C', first, '-c', 'user.name=F', '-c', 'user.email=f@example.invalid', 'commit', '-qm', 'Initialize prepared contest project']);
    runGit(['-C', first, 'push', '-q', '--set-upstream', remote, 'HEAD:main']);

    // 第二份副本：与远端分叉（另起一个初始提交）
    const second = path.join(tmp, 'second');
    await mkdir(second, { recursive: true });
    for (const name of ['README.md', 'UPSTREAM.md', 'CONTRIBUTIONS.md']) await writeFile(path.join(second, name), 'second\n');
    await mkdir(path.join(second, 'reports'), { recursive: true });
    await writeFile(path.join(second, 'reports', 'daily.md'), '# daily\n');
    runGit(['-C', second, 'init', '-q']);
    runGit(['-C', second, 'add', '-A']);
    runGit(['-C', second, '-c', 'user.name=F', '-c', 'user.email=f@example.invalid', 'commit', '-qm', 'Initialize prepared contest project']);

    const sync = reconcileRemoteHistory(second, remote, 'main', { authorName: 'Contest Author', authorEmail: 'author@example.invalid' });
    assert.equal(sync.replay, true, 'diverged history is replayed, not rejected');
    runGit(['-C', second, 'push', '-q', '--set-upstream', remote, 'HEAD:main']);

    // 远端 HEAD 现在与工作副本一致，且保留了两条历史。
    const check = path.join(tmp, 'check');
    runGit(['clone', '-q', remote, check]);
    runGit(['-C', check, 'checkout', '-q', 'main']);
    assert.equal(runGit(['-C', check, 'log', '--oneline']).trim().split('\n').length >= 2, true, 'remote history preserved');
    assert.equal(await readFile(path.join(check, 'reports', 'daily.md'), 'utf8'), '# daily\n');
    assert.equal(await readFile(path.join(check, 'README.md'), 'utf8'), 'second\n');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// 源文件带行尾空白很常见：只作告警记录，不能卡住初始化与推送（真实事故：validate-skill.sh:80 尾空格）。
test('trailing whitespace in the work copy is reported as a warning, not a failure', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'contest-git-ws-'));
  try {
    const work = path.join(tmp, 'work');
    await mkdir(path.join(work, 'scripts'), { recursive: true });
    for (const name of ['README.md', 'UPSTREAM.md', 'CONTRIBUTIONS.md']) await writeFile(path.join(work, name), '# doc\n');
    await writeFile(path.join(work, '.contest-publisher-manifest.json'), JSON.stringify({ schemaVersion: 1, copied: [] }));
    await writeFile(path.join(work, 'scripts', 'validate.sh'), '#!/bin/bash\nset -e   \necho ok\n');

    const result = initPreparedRepo(work, { remote: 'https://gitcode.com/org/repo.git', authorName: 'Contest Author', authorEmail: 'author@example.invalid' });
    assert.equal(result.stagedFiles.includes('scripts/validate.sh'), true);
    assert.equal(Array.isArray(result.whitespace), true, '空白告警随结果返回');
    assert.match(result.whitespace.join('\n'), /validate\.sh:2: trailing whitespace/);
    assert.equal(runGit(['-C', work, 'rev-parse', '--verify', 'HEAD']).trim().length > 0, true, '仍然完成提交');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
