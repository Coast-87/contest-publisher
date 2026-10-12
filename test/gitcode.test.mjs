import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGitCodeCreateRequest, buildGitCodeVisibilityRequest, splitGitCodeRepoPath } from '../src/gitcode.mjs';

test('builds a private GitCode repository request without putting credentials in the body', () => {
  const request = buildGitCodeCreateRequest({ name: 'contest-project', privateRepo: true, token: 'test-token' });
  assert.equal(request.method, 'POST');
  assert.equal(request.body.private, true);
  assert.equal(request.body.auto_init, false);
  assert.equal(request.body.name, 'contest-project');
  assert.equal(request.url.searchParams.get('access_token'), 'test-token');
  assert.equal(JSON.stringify(request.body).includes('test-token'), false);
});

// ICT only accepts works whose repository is visible to everyone, so creating is public by default.
test('creates public repositories by default', () => {
  assert.equal(buildGitCodeCreateRequest({ name: 'contest-project', token: 't' }).body.private, false);
});

test('rejects unsafe repository names', () => {
  assert.throws(() => buildGitCodeCreateRequest({ name: '../owned', token: 'x' }), /Repository name/);
});

test('builds a visibility request against the repo settings endpoint', () => {
  const request = buildGitCodeVisibilityRequest({ owner: 'coastt', repo: 'GitHub-Trending', token: 'test-token' });
  assert.equal(request.method, 'PATCH');
  assert.equal(request.url.pathname, '/api/v5/repos/coastt/GitHub-Trending');
  assert.equal(request.body.private, false);
  assert.equal(request.url.searchParams.get('access_token'), 'test-token');
  assert.equal(JSON.stringify(request.body).includes('test-token'), false);
  assert.equal(buildGitCodeVisibilityRequest({ owner: 'g/sub', repo: 'r.git', token: 't' }).url.pathname, '/api/v5/repos/g/sub/r');
  assert.throws(() => buildGitCodeVisibilityRequest({ owner: 'a b', repo: 'r', token: 't' }), /safe GitCode path/);
});

test('splits owner and repo out of a GitCode web or clone URL', () => {
  assert.deepEqual(splitGitCodeRepoPath('https://gitcode.com/coastt/GitHub-Trending'), { owner: 'coastt', repo: 'GitHub-Trending' });
  assert.deepEqual(splitGitCodeRepoPath('https://gitcode.com/coastt/GitHub-Trending.git'), { owner: 'coastt', repo: 'GitHub-Trending' });
  assert.deepEqual(splitGitCodeRepoPath('https://gitcode.com/group/sub/project.git'), { owner: 'group/sub', repo: 'project' });
  assert.deepEqual(splitGitCodeRepoPath('not a url'), { owner: '', repo: '' });
});
