import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { acquireLocalSource, listLocalSources, repoNameFromLocal, repoNameFromUrl, validateSourceUrl } from '../src/acquire.mjs';
import { run, runGit } from '../src/process.mjs';
import { exists } from '../src/store.mjs';

test('accepts credential-free HTTPS clone URLs', () => {
  assert.equal(validateSourceUrl('https://gitcode.com/team/project.git'), 'https://gitcode.com/team/project.git');
});

test('rejects URL credentials and query tokens before any git operation', () => {
  assert.throws(() => validateSourceUrl('https://user:token@gitcode.com/team/project.git'), /no credentials/);
  assert.throws(() => validateSourceUrl('https://gitcode.com/team/project.git?access_token=secret'), /query string/);
  assert.throws(() => validateSourceUrl('file:///tmp/project'), /HTTPS/);
});

// The target repo name follows the source repo, so a blank config field never
// silently publishes into a generic "contest-project" repo.
test('derives the target repo name from the source URL', () => {
  assert.equal(repoNameFromUrl('https://gitcode.com/org/Project.git'), 'Project');
  assert.equal(repoNameFromUrl('https://gitcode.com/org/Project'), 'Project');
  assert.equal(repoNameFromUrl('https://gitcode.com/org/team/my.repo-name.git'), 'my.repo-name');
  assert.equal(repoNameFromUrl('https://gitcode.com/org/%E4%BD%9C%E5%93%81.git'), '作品');
  assert.equal(repoNameFromUrl('https://gitcode.com/org/we ird*name.git'), 'weirdname');
  assert.equal(repoNameFromUrl('not a url'), '');
});

// 本地仓库：把 GitHub 下载的代码包（文件夹或 zip）做成只读快照，下游流程与 Git 源一致。
test('acquires a local folder as an immutable git snapshot', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'contest-local-'));
  try {
    const sources = path.join(tmp, 'sources');
    const project = path.join(sources, 'My-Project-main');
    await mkdir(path.join(project, 'src'), { recursive: true });
    await writeFile(path.join(project, 'src', 'main.js'), 'export const answer = 42;\n');
    await writeFile(path.join(project, 'README.md'), '# My Project\n');
    await writeFile(path.join(project, '.DS_Store'), 'junk');

    const listed = await listLocalSources(sources);
    assert.deepEqual(listed.entries.map(item => item.name), ['My-Project-main']);
    assert.equal(listed.entries[0].kind, 'dir');

    const result = await acquireLocalSource({ entryName: 'My-Project-main', sourcesDir: sources, runsRoot: path.join(tmp, 'runs') });
    assert.equal(result.source.sourceKind, 'local');
    // 本地代码包没有上游基线，严格模式的"原创增量"必然不满足：默认按搬运模式发布并留痕。
    const mode = JSON.parse(await readFile(path.join(result.runDir, 'evidence', 'run-mode.json'), 'utf8'));
    assert.equal(mode.mode, 'copy');
    assert.match(mode.note, /本地代码包/);
    assert.equal(result.source.localName, 'My-Project-main');
    assert.equal(result.source.sourceUrl, null);
    assert.equal(await exists(path.join(result.sourceDir, 'src', 'main.js')), true);
    assert.equal(await exists(path.join(result.sourceDir, '.DS_Store')), false, 'junk is skipped');
    // 快照是 git 仓库：审计按索引工作。
    assert.equal(runGit(['-C', result.sourceDir, 'ls-files']).trim().split('\n').sort().join(','), 'README.md,src/main.js');
    assert.equal(runGit(['-C', result.sourceDir, 'status', '--porcelain']).trim(), '');
    assert.equal(repoNameFromLocal('My-Project-main'), 'My-Project');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('acquires a local zip (GitHub download) and flattens its single top-level folder', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'contest-zip-'));
  try {
    const sources = path.join(tmp, 'sources');
    const staging = path.join(tmp, 'staging', 'Repo-main');
    await mkdir(path.join(staging, 'app'), { recursive: true });
    await writeFile(path.join(staging, 'app', 'index.html'), '<!doctype html><title>App</title>\n');
    await writeFile(path.join(staging, 'README.md'), '# Repo\n');
    const zip = path.join(sources, 'Repo-main.zip');
    await mkdir(sources, { recursive: true });
    run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(tmp, 'staging', 'Repo-main'), zip]);

    const listed = await listLocalSources(sources);
    assert.equal(listed.entries[0].kind, 'zip');

    const result = await acquireLocalSource({ entryName: 'Repo-main.zip', sourcesDir: sources, runsRoot: path.join(tmp, 'runs') });
    assert.equal(result.source.localName, 'Repo-main.zip');
    assert.equal(await exists(path.join(result.sourceDir, 'app', 'index.html')), true, 'top-level folder flattened');
    assert.equal(await exists(path.join(result.sourceDir, 'Repo-main')), false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
