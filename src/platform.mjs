import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 平台差异集中在这里：所有函数都接受可注入的 platform/env，便于在 macOS 上单测 Windows 分支。
export const PLATFORM = process.platform;
export const IS_WINDOWS = PLATFORM === 'win32';
export const IS_MAC = PLATFORM === 'darwin';
export const IS_LINUX = PLATFORM === 'linux';

// 目标平台的路径语义必须和目标平台一致：在 macOS 上拼 Windows 路径也要用反斜杠，
// 否则「Windows 分支」在非 Windows 上跑出来的东西是混合分隔符，等于没法验证。
function joiner(platform) {
  return platform === 'win32' ? path.win32.join : path.posix.join;
}

// unix 的空设备是 /dev/null；Windows 的原生进程不认这个路径（那是 MSYS 的映射），用 NUL。
export function nullDevice(platform = PLATFORM) {
  return platform === 'win32' ? 'NUL' : '/dev/null';
}

// GIT_CONFIG_GLOBAL 指向不存在的文件=空配置；Windows 上直接指向 NUL 会让 git 打开设备文件，
// 语义不如「文件不存在」干净，所以两个平台用各自最稳的写法。
export function emptyGitConfig(platform = PLATFORM, tmpdir = os.tmpdir()) {
  return platform === 'win32' ? joiner(platform)(tmpdir, 'contest-publisher-empty-gitconfig') : '/dev/null';
}

// core.hooksPath 只要指向一个「不是钩子目录」的路径，git 就找不到钩子可执行。
// unix 用 /dev/null，Windows 用一个真实存在的空目录（git 对 NUL 做目录判断结果不确定）。
export function hooksPathValue(platform = PLATFORM, tmpdir = os.tmpdir()) {
  return platform === 'win32' ? joiner(platform)(tmpdir, 'contest-publisher-no-hooks') : '/dev/null';
}

function envValue(env, name) {
  const value = env?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

// GUI 启动（Finder / 资源管理器双击）时 PATH 很短，装在 nvm/volta/fnm/scoop 里的 node 看不见，
// 所以除了 PATH 探测还要探这些常见安装位置。listDir 可注入，测试里不用碰真实文件系统。
export function knownNodePaths({ platform = PLATFORM, env = process.env, listDir = safeReaddir } = {}) {
  const home = envValue(env, 'HOME') || envValue(env, 'USERPROFILE') || os.homedir();
  if (platform === 'win32') {
    const join = joiner(platform);
    const local = envValue(env, 'LOCALAPPDATA') || join(home, 'AppData', 'Local');
    const roaming = envValue(env, 'APPDATA') || join(home, 'AppData', 'Roaming');
    const candidates = [
      join(envValue(env, 'ProgramFiles') || 'C:\\Program Files', 'nodejs', 'node.exe'),
      join(envValue(env, 'ProgramFiles(x86)') || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
      join(local, 'Programs', 'nodejs', 'node.exe'),
      join(local, 'Volta', 'bin', 'node.exe'),
      join(local, 'fnm', 'aliases', 'default', 'node.exe'),
      join(home, 'scoop', 'apps', 'nodejs', 'current', 'node.exe'),
    ];
    // nvm-windows：当前版本挂在 %NVM_SYMLINK%（默认 C:\Program Files\nodejs），各版本在 %NVM_HOME% 下。
    const symlink = envValue(env, 'NVM_SYMLINK');
    if (symlink) candidates.unshift(join(symlink, 'node.exe'));
    const nvmHomes = [envValue(env, 'NVM_HOME'), join(roaming, 'nvm')].filter(Boolean);
    for (const nvmHome of nvmHomes) {
      for (const name of latestFirst(listDir(nvmHome).filter(item => /^v\d/.test(item)))) {
        candidates.push(join(nvmHome, name, 'node.exe'));
      }
    }
    return candidates.filter(Boolean);
  }
  const candidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    `${home}/.volta/bin/node`,
    `${home}/.fnm/aliases/default/bin/node`,
  ];
  for (const name of latestFirst(listDir(`${home}/.nvm/versions/node`).filter(item => /^v\d/.test(item)))) {
    candidates.push(`${home}/.nvm/versions/node/${name}/bin/node`);
  }
  return candidates;
}

function safeReaddir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

function latestFirst(names) {
  return [...names].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
}

// 系统的 PATH 探测：unix 用 which，Windows 用 where（Node 的 spawnSync 不做 PATHEXT 展开，
// 直接 exec 'node' 会漏掉 node.cmd 之类的装法）。
export function whichSync(command, { platform = PLATFORM, env = process.env, run: runCommand = spawnSync } = {}) {
  const [locator, args] = platform === 'win32' ? ['where', [command]] : ['/usr/bin/which', [command]];
  const attempts = platform === 'win32' ? [locator, 'where.exe'] : [locator, 'which'];
  for (const tool of attempts) {
    try {
      const result = runCommand(tool, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env });
      if (result?.error || result?.status !== 0) continue;
      const found = String(result.stdout ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0];
      if (found) return found;
    } catch { /* try next locator */ }
  }
  return null;
}

// KooCLI 在 Windows 上的常见落点；PATH 探测由调用方兜底。
export function knownHcloudPaths({ platform = PLATFORM, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const join = joiner(platform);
    const local = envValue(env, 'LOCALAPPDATA') || join(home, 'AppData', 'Local');
    const programFiles = envValue(env, 'ProgramFiles') || 'C:\\Program Files';
    return [
      join(programFiles, 'HuaweiCloud', 'KooCLI', 'hcloud.exe'),
      join(local, 'HuaweiCloud', 'KooCLI', 'hcloud.exe'),
      join(home, '.huaweicloud', 'hcloud.exe'),
      join(local, 'Programs', 'KooCLI', 'hcloud.exe'),
    ];
  }
  return ['/usr/local/bin/hcloud', '/opt/homebrew/bin/hcloud', `${home}/.local/bin/hcloud`];
}

export function knownGitPaths({ platform = PLATFORM, env = process.env } = {}) {
  if (platform === 'win32') {
    const join = joiner(platform);
    const programFiles = envValue(env, 'ProgramFiles') || 'C:\\Program Files';
    const programFilesX86 = envValue(env, 'ProgramFiles(x86)') || 'C:\\Program Files (x86)';
    const local = envValue(env, 'LOCALAPPDATA') || '';
    return [
      join(programFiles, 'Git', 'cmd', 'git.exe'),
      join(programFilesX86, 'Git', 'cmd', 'git.exe'),
      local ? join(local, 'Programs', 'Git', 'cmd', 'git.exe') : '',
    ].filter(Boolean);
  }
  return ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
}

export function gitInstallHint(platform = PLATFORM) {
  return platform === 'win32'
    ? '请安装 Git for Windows（https://git-scm.com/download/win），安装时保持默认的「Git from the command line」'
    : '请安装 Xcode Command Line Tools: xcode-select --install';
}

// STS 生成脚本是 python：macOS 自带 /usr/bin/python3，Windows 上是 py 启动器或 PATH 里的 python。
export function pythonCandidates({ platform = PLATFORM, env = process.env } = {}) {
  const override = envValue(env, 'CONTEST_PUBLISHER_PYTHON');
  if (override) return [override];
  return platform === 'win32' ? ['py', 'python', 'python3'] : ['/usr/bin/python3', 'python3', 'python'];
}

// 找一个真的能跑的 python：Windows 上 py/python 都可能是 Microsoft Store 的占位壳，
// 只有执行 --version 成功才算数。
export function resolvePython({ platform = PLATFORM, env = process.env, run: runCommand = spawnSync } = {}) {
  const candidates = pythonCandidates({ platform, env });
  for (const candidate of candidates) {
    const probe = runCommand(candidate, ['--version'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'], env });
    if (!probe?.error && probe?.status === 0) return candidate;
  }
  return candidates[0];
}

// 打开路径 / 链接：不经过 shell，也就不会被路径里的空格、引号或中文分词。
export function openTargetCommand(target, { platform = PLATFORM, kind = 'path' } = {}) {
  if (platform === 'darwin') return { command: 'open', args: [target] };
  if (platform === 'win32') {
    return kind === 'url'
      ? { command: 'rundll32', args: ['url.dll,FileProtocolHandler', target] }
      : { command: 'explorer', args: [target] };
  }
  return { command: 'xdg-open', args: [target] };
}

export function openTarget(target, options = {}) {
  const { command, args } = openTargetCommand(target, options);
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}

// Windows 上没有可编译的 WebKit 壳，工作台用一个「应用窗口」呈现：Edge / Chrome 的 --app 模式
// 没有地址栏和标签页，看起来就是一个独立软件窗口。系统自带 Edge，所以这条路基本总能走通。
export function chromiumCandidates({ platform = PLATFORM, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const join = joiner(platform);
    const programFiles = envValue(env, 'ProgramFiles') || 'C:\\Program Files';
    const programFilesX86 = envValue(env, 'ProgramFiles(x86)') || 'C:\\Program Files (x86)';
    const local = envValue(env, 'LOCALAPPDATA') || join(home, 'AppData', 'Local');
    return [
      join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];
  }
  return ['microsoft-edge', 'google-chrome', 'chromium', 'chromium-browser'];
}

// --user-data-dir 是必需的：否则已有浏览器实例会接管这个 URL、启动进程立刻退出，
// 启动器就分不清「窗口还在」和「窗口已关」，会在用户还没看完时就把服务关掉。
export function appWindowArgs(url, { profileDir, width = 1440, height = 920 } = {}) {
  const args = [`--app=${url}`, '--no-first-run', '--no-default-browser-check', `--window-size=${width},${height}`];
  if (profileDir) args.push(`--user-data-dir=${profileDir}`);
  return args;
}

export function findChromium({ platform = PLATFORM, env = process.env, exists = existsSync } = {}) {
  for (const candidate of chromiumCandidates({ platform, env })) {
    try { if (exists(candidate)) return candidate; } catch { /* keep looking */ }
  }
  return null;
}

// 打包后的二进制：assets/ 与内置 Skill 放在可执行文件旁边（mac 的 .app 里就是 Contents/Resources）。
// 开发态（node bin/…、bun bin/…）落回项目根目录。返回候选列表，调用方按存在性取第一个。
export function sidecarRoots() {
  const roots = [];
  const exe = process.execPath ?? '';
  const exeName = path.basename(exe).toLowerCase();
  const bundled = Boolean(process.versions?.bun) && !/^bun(x)?(\.exe)?$/.test(exeName) && !exeName.startsWith('node');
  if (bundled && exe) roots.push(path.dirname(exe));
  roots.push(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  return [...new Set(roots)];
}

export function resolveSidecar(name, { check = existsSync, roots = sidecarRoots() } = {}) {
  for (const root of roots) {
    const candidate = path.join(root, name);
    try { if (check(candidate)) return candidate; } catch { /* keep looking */ }
  }
  return null;
}

// 启动器日志：Windows 无控制台窗口时看不到任何输出，出问题全靠这个文件。
export function appendLauncherLog(line, { dir = defaultLogDir(), file = 'launcher.log' } = {}) {
  try {
    mkdirSync(dir, { recursive: true });
    const target = path.join(dir, file);
    appendFileSync(target, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
    return target;
  } catch { return null; }
}

export function defaultLogDir({ platform = PLATFORM, env = process.env, home = os.homedir() } = {}) {
  const join = joiner(platform);
  if (platform === 'win32') {
    const local = envValue(env, 'LOCALAPPDATA') || join(home, 'AppData', 'Local');
    return join(local, 'Contest Publisher');
  }
  if (platform === 'darwin') return join(home, 'Library', 'Logs', 'Contest Publisher');
  return join(envValue(env, 'XDG_STATE_HOME') || join(home, '.local', 'state'), 'contest-publisher');
}
