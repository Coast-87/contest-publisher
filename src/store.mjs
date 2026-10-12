import { mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const { rename } = await import('node:fs/promises');
  await rename(temporary, file);
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function removeEmptyOrMissing(file) {
  try {
    const entries = await readdir(file);
    if (entries.length) throw new Error(`Destination is not empty: ${file}`);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
}

export function runId(now = new Date()) {
  const date = now.toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${date}-${randomBytes(3).toString('hex')}`;
}

export function inside(parent, candidate) {
  const rel = path.relative(path.resolve(parent), path.resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

// Expand a leading ~ so the UI can send back exactly the value it displays.
export function expandHome(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text === '~') return os.homedir();
  if (text.startsWith('~/') || text.startsWith(`~${path.sep}`)) return path.join(os.homedir(), text.slice(2));
  return text;
}

// Settings live in a stable directory: the runs root itself can be switched.
export function settingsFile() {
  const home = process.env.CONTEST_PUBLISHER_HOME || path.join(os.homedir(), '.contest-publisher');
  return path.resolve(home, 'settings.json');
}

export async function readSettings(legacyRoot) {
  const candidates = [settingsFile()];
  if (legacyRoot) candidates.push(path.join(path.resolve(legacyRoot), '.settings.json'));
  for (const file of candidates) {
    try { return await readJson(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return {};
}

export async function writeSettings(settings) {
  const file = settingsFile();
  await writeJson(file, settings);
  return file;
}

// 配置导入/导出：只认这些键，文件里的其它键一律忽略，避免把任意内容写进设置文件。
// cfgGitToken 是凭证，导出时默认不含（要含必须显式要求），导入时按文件内容如实应用。
export const CONFIG_KEYS = [
  'cfgRepoName', 'cfgGitToken', 'cfgAuthorName', 'cfgAuthorEmail', 'cfgAccountId', 'cfgCredsPath',
  'cfgProblemNumber', 'cfgProblemName', 'cfgKeepPaths', 'cfgLocalSourcesDir', 'cfgExecuteSubmit', 'runsRoot',
];
export const SECRET_CONFIG_KEYS = ['cfgGitToken'];

// 导出文件落在设置文件旁边（默认 ~/.contest-publisher/），导出后会打开这个目录。
export function configDir() {
  return path.dirname(settingsFile());
}

export function resolveRunsRoot(value) {
  const expanded = expandHome(value);
  if (!expanded) return null;
  const resolved = path.resolve(expanded);
  if (resolved === path.parse(resolved).root) throw new Error('运行根目录不能是文件系统根目录');
  return resolved;
}

// Precedence: saved setting > CONTEST_PUBLISHER_RUNS > ~/contest-publisher-runs
export async function defaultRunsRoot() {
  try {
    const configured = resolveRunsRoot((await readSettings()).runsRoot);
    if (configured) return configured;
  } catch { /* fall through to the built-in default */ }
  const fromEnv = resolveRunsRoot(process.env.CONTEST_PUBLISHER_RUNS);
  if (fromEnv) return fromEnv;
  return path.resolve(os.homedir(), 'contest-publisher-runs');
}

export function resolveLocalSourcesDir(value) {
  const expanded = expandHome(value);
  if (!expanded) return null;
  const resolved = path.resolve(expanded);
  if (resolved === path.parse(resolved).root) throw new Error('本地仓库目录不能是文件系统根目录');
  return resolved;
}

// 本地仓库目录：把 GitHub 下载的代码包（文件夹或 zip）丢进来，工作台下拉选取即可。
// Precedence: saved setting > CONTEST_PUBLISHER_SOURCES > ~/contest-publisher-sources
export async function defaultLocalSourcesDir() {
  try {
    const configured = resolveLocalSourcesDir((await readSettings()).localSourcesDir);
    if (configured) return configured;
  } catch { /* fall through to the built-in default */ }
  const fromEnv = resolveLocalSourcesDir(process.env.CONTEST_PUBLISHER_SOURCES);
  if (fromEnv) return fromEnv;
  return path.resolve(os.homedir(), 'contest-publisher-sources');
}

const SOURCES_README = `把要提交的代码包放进这个文件夹，然后在软件 01 面板选「本地仓库」下拉选取。

支持两种形式：
  - 文件夹：例如从 GitHub 解压出来的 repo-main 文件夹，直接整个拷进来；
  - zip 包：GitHub 的 Download ZIP 原样放进来（会自动解压，只有一层顶层目录时自动展平）。

放好后回到软件点「刷新列表」。这里的内容只作为只读源快照复制进每次运行，不会修改原件。
`;

// 首次使用自动建目录并留一份说明，方便把软件直接给别人用。
export async function ensureLocalSourcesDir(dir) {
  const resolved = resolveLocalSourcesDir(dir) ?? await defaultLocalSourcesDir();
  const fresh = !(await exists(resolved));
  await ensureDir(resolved);
  if (fresh) await writeFile(path.join(resolved, 'README.txt'), SOURCES_README, { encoding: 'utf8', mode: 0o600 });
  return resolved;
}
