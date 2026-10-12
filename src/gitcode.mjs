const DEFAULT_ENDPOINT = 'https://api.gitcode.com/api/v5/user/repos';
const API_HOST = 'api.gitcode.com';

// ICT 平台只接受「所有人可见」的作品仓库，所以新建默认公开；privateRepo 仍可显式传 true。
export function buildGitCodeCreateRequest({ name, description = '', privateRepo = false, defaultBranch = 'main', endpoint = DEFAULT_ENDPOINT, token }) {
  if (!token) throw new Error('GitCode access token is required through GITCODE_ACCESS_TOKEN');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) throw new Error('Repository name must be 1-100 characters: letters, digits, dot, underscore, hyphen');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.hostname !== API_HOST || url.pathname !== '/api/v5/user/repos') {
    throw new Error('GitCode API endpoint must be https://api.gitcode.com/api/v5/user/repos');
  }
  url.searchParams.set('access_token', token);
  return {
    url,
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: { name, description, private: Boolean(privateRepo), default_branch: defaultBranch, auto_init: false },
  };
}

// Splits a GitCode web/clone URL into the owner path and repository name (group paths may nest).
export function splitGitCodeRepoPath(webUrl) {
  try {
    const parts = new URL(webUrl).pathname.split('/').filter(Boolean);
    const repo = (parts.pop() ?? '').replace(/\.git$/i, '');
    return { owner: parts.join('/'), repo };
  } catch {
    return { owner: '', repo: '' };
  }
}

// 仓库可见性走 /api/v5/repos/{owner}/{repo}（Gitee 兼容）：老 run 建出的私有仓库靠这里改公开。
export function buildGitCodeVisibilityRequest({ owner, repo, privateRepo = false, endpoint, token }) {
  if (!token) throw new Error('GitCode access token is required through GITCODE_ACCESS_TOKEN');
  const ownerPath = String(owner ?? '').trim().replace(/^\/+|\/+$/g, '');
  const repoName = String(repo ?? '').trim().replace(/\.git$/i, '');
  if (!ownerPath || !repoName || /[^A-Za-z0-9._/-]/.test(`${ownerPath}/${repoName}`) || `${ownerPath}/${repoName}`.includes('..')) {
    throw new Error('Repository owner and name must be a safe GitCode path');
  }
  const url = new URL(endpoint ?? `https://${API_HOST}/api/v5/repos/${ownerPath}/${repoName}`);
  if (url.protocol !== 'https:' || url.hostname !== API_HOST || !url.pathname.startsWith('/api/v5/repos/')) {
    throw new Error('GitCode API endpoint must be https://api.gitcode.com/api/v5/repos/<owner>/<repo>');
  }
  url.searchParams.set('access_token', token);
  return {
    url,
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: { private: Boolean(privateRepo) },
  };
}

// 目标仓库已经存在（例如同一个代码包再次提交）时，建仓会失败——这里读回已有仓库记录复用，
// 而不是把流程卡死。owner 取当前 token 的登录名，只认自己名下的同名仓库。
export async function fetchGitCodeUserLogin(token) {
  const url = new URL('https://api.gitcode.com/api/v5/user');
  url.searchParams.set('access_token', token);
  const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error' });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!response.ok || !data.login) throw new Error(`GitCode user lookup failed (${response.status})`);
  return data.login;
}

export async function fetchGitCodeRepo({ owner, repo, token }) {
  const path = [owner, repo].map(part => String(part ?? '').trim()).filter(Boolean).join('/');
  if (!owner || !repo || /[^A-Za-z0-9._/-]/.test(path)) throw new Error('Repository owner and name must be a safe GitCode path');
  const url = new URL(`https://api.gitcode.com/api/v5/repos/${path}`);
  url.searchParams.set('access_token', token);
  const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error' });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!response.ok) throw new Error(`GitCode repository lookup failed (${response.status})`);
  const fullName = data.full_name ?? path;
  const webUrl = data.web_url ?? `https://gitcode.com/${fullName}`;
  const cloneUrl = data.http_url_to_repo ?? `${webUrl}.git`;
  return { id: data.id ?? null, name: data.name ?? repo, webUrl, cloneUrl: cloneUrl.endsWith('.git') ? cloneUrl : `${cloneUrl}.git`, defaultBranch: data.default_branch ?? 'main', private: data.private === true, public: data.public === true };
}

// 建仓 + 同名复用：名称已被占用（通常是上次提交建过的同名仓库）时读回并复用。
export async function createOrReuseGitCodeRepo(options) {
  try {
    return { ...(await createGitCodeRepo(options)), reused: false };
  } catch (error) {
    try {
      const login = await fetchGitCodeUserLogin(options.token);
      const existing = await fetchGitCodeRepo({ owner: login, repo: options.name, token: options.token });
      return { ...existing, reused: true };
    } catch {
      throw error; // 复用也失败时报原始建仓错误（信息更完整）
    }
  }
}

export async function createGitCodeRepo(options) {
  const request = buildGitCodeCreateRequest(options);
  let response;
  try {
    response = await fetch(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(request.body), redirect: 'error' });
  } catch (error) {
    throw new Error(`GitCode repository creation request failed: ${String(error.message).replaceAll(options.token, '[REDACTED]')}`);
  }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 1000) }; }
  if (!response.ok) {
    const message = String(data.message ?? data.error ?? 'API error').replaceAll(options.token, '[REDACTED]');
    throw new Error(`GitCode repository creation failed (${response.status}): ${message}`);
  }
  const fullName = data.full_name ?? data.path_with_namespace ?? null;
  const webUrl = data.web_url ?? data.html_url ?? (fullName ? `https://gitcode.com/${fullName}` : null);
  const cloneUrl = data.http_url_to_repo ?? data.clone_url ?? (fullName ? `${webUrl}.git` : null);
  if (!cloneUrl) throw new Error('GitCode response did not include full_name or a repository URL');
  return { id: data.id ?? null, name: data.name ?? options.name, webUrl, cloneUrl: cloneUrl.endsWith('.git') ? cloneUrl : `${cloneUrl}.git`, defaultBranch: data.default_branch ?? options.defaultBranch ?? 'main', private: data.private === true, public: data.public === true };
}

// 幂等：仓库已是公开也会返回成功，可安全地在每次推送前调用。
export async function setGitCodeRepoVisibility({ webUrl, owner, repo, privateRepo = false, token }) {
  const resolved = owner && repo ? { owner, repo } : splitGitCodeRepoPath(webUrl ?? '');
  const request = buildGitCodeVisibilityRequest({ ...resolved, privateRepo, token });
  let response;
  try {
    response = await fetch(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(request.body), redirect: 'error' });
  } catch (error) {
    throw new Error(`GitCode visibility request failed: ${String(error.message).replaceAll(token, '[REDACTED]')}`);
  }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 1000) }; }
  if (!response.ok) {
    const message = String(data.message ?? data.error ?? 'API error').replaceAll(token, '[REDACTED]');
    throw new Error(`GitCode visibility update failed (${response.status}): ${message}`);
  }
  return {
    fullName: data.full_name ?? `${resolved.owner}/${resolved.repo}`,
    private: data.private === true,
    public: data.public === true,
    webUrl: data.web_url ?? webUrl ?? null,
  };
}
