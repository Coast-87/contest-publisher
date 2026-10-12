import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { zipExtractCommands } from '../src/acquire.mjs';
import { runGit } from '../src/process.mjs';
import {
  appWindowArgs,
  chromiumCandidates,
  defaultLogDir,
  emptyGitConfig,
  findChromium,
  hooksPathValue,
  knownGitPaths,
  knownHcloudPaths,
  knownNodePaths,
  nullDevice,
  openTargetCommand,
  pythonCandidates,
  resolvePython,
  resolveSidecar,
  sidecarRoots,
  whichSync,
} from '../src/platform.mjs';
import { defaultProfileDir, isHeadlessConsole, runWorkbenchSession } from '../src/launcher.mjs';

// 这些用例全部在 macOS 上跑，但断言的是 Windows 分支的行为：平台差异必须是纯函数，
// 否则「Windows 版能不能用」就只能等真机试。所有外部依赖（文件系统、PATH 探测、子进程）都可注入。

const winEnv = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  USERPROFILE: 'C:\\Users\\me',
  PATH: 'C:\\Windows\\System32',
};

test('empty devices and hook paths differ per platform', () => {
  assert.equal(nullDevice('win32'), 'NUL');
  assert.equal(nullDevice('darwin'), '/dev/null');
  assert.equal(emptyGitConfig('darwin', '/tmp'), '/dev/null');
  assert.equal(emptyGitConfig('win32', 'C:\\Temp'), path.win32.join('C:\\Temp', 'contest-publisher-empty-gitconfig'));
  assert.equal(hooksPathValue('darwin', '/tmp'), '/dev/null');
  assert.equal(hooksPathValue('win32', 'C:\\Temp'), path.win32.join('C:\\Temp', 'contest-publisher-no-hooks'));
});

test('windows node discovery covers the installers users actually use', () => {
  const paths = knownNodePaths({
    platform: 'win32',
    env: winEnv,
    listDir: dir => (dir.endsWith('nvm') ? ['v18.19.0', 'v20.11.1'] : []),
  });
  assert.ok(paths.includes(path.win32.join('C:\\Program Files', 'nodejs', 'node.exe')));
  assert.ok(paths.includes(path.win32.join('C:\\Users\\me\\AppData\\Local', 'Volta', 'bin', 'node.exe')));
  assert.ok(paths.includes(path.win32.join('C:\\Users\\me\\AppData\\Local', 'fnm', 'aliases', 'default', 'node.exe')));
  // nvm-windows 的版本目录：最新版排在最前面
  assert.equal(paths[paths.findIndex(item => item.includes('nvm'))], path.win32.join('C:\\Users\\me\\AppData\\Roaming', 'nvm', 'v20.11.1', 'node.exe'));
});

test('unix node discovery keeps the homebrew/volta/nvm locations', () => {
  const paths = knownNodePaths({ platform: 'darwin', env: { HOME: '/Users/me' }, listDir: () => ['v18.19.0', 'v20.11.1'] });
  assert.ok(paths.includes('/opt/homebrew/bin/node'));
  assert.ok(paths.includes('/Users/me/.volta/bin/node'));
  assert.ok(paths.includes('/Users/me/.nvm/versions/node/v20.11.1/bin/node'));
});

test('PATH lookup uses where on windows and which elsewhere', () => {
  const calls = [];
  const fakeRun = (command, args) => { calls.push([command, args]); return { status: 0, stdout: 'C:\\Program Files\\nodejs\\node.exe\r\n' }; };
  assert.equal(whichSync('node', { platform: 'win32', env: winEnv, run: fakeRun }), 'C:\\Program Files\\nodejs\\node.exe');
  assert.equal(calls[0][0], 'where');
  const unixCalls = [];
  const unixRun = (command, args) => { unixCalls.push([command, args]); return { status: 0, stdout: '/usr/local/bin/node\n' }; };
  assert.equal(whichSync('node', { platform: 'darwin', run: unixRun }), '/usr/local/bin/node');
  assert.equal(unixCalls[0][0], '/usr/bin/which');
  // 找不到时返回 null，而不是把错误字符串当路径
  assert.equal(whichSync('node', { platform: 'darwin', run: () => ({ status: 1, stdout: '' }) }), null);
});

test('git and hcloud discovery carry windows install locations', () => {
  assert.ok(knownGitPaths({ platform: 'win32', env: winEnv }).includes(path.win32.join('C:\\Program Files', 'Git', 'cmd', 'git.exe')));
  assert.ok(knownGitPaths({ platform: 'darwin' }).includes('/usr/bin/git'));
  assert.ok(knownHcloudPaths({ platform: 'win32', env: winEnv }).includes(path.win32.join('C:\\Program Files', 'HuaweiCloud', 'KooCLI', 'hcloud.exe')));
});

test('python discovery prefers the platform launcher and verifies it runs', () => {
  assert.deepEqual(pythonCandidates({ platform: 'win32', env: {} }), ['py', 'python', 'python3']);
  assert.equal(pythonCandidates({ platform: 'darwin', env: {} })[0], '/usr/bin/python3');
  assert.deepEqual(pythonCandidates({ platform: 'win32', env: { CONTEST_PUBLISHER_PYTHON: 'C:\\Python312\\python.exe' } }), ['C:\\Python312\\python.exe']);
  // Microsoft Store 的 python 占位壳会返回非 0，必须跳到下一个候选
  const tried = [];
  const resolved = resolvePython({
    platform: 'win32',
    env: {},
    run: command => { tried.push(command); return { status: command === 'py' ? 9009 : 0, stdout: 'Python 3.12.0' }; },
  });
  assert.deepEqual(tried, ['py', 'python']);
  assert.equal(resolved, 'python');
});

test('opening a path or url never goes through a shell', () => {
  assert.deepEqual(openTargetCommand('/tmp/x', { platform: 'darwin' }), { command: 'open', args: ['/tmp/x'] });
  assert.deepEqual(openTargetCommand('C:\\work\\x', { platform: 'win32', kind: 'path' }), { command: 'explorer', args: ['C:\\work\\x'] });
  assert.deepEqual(openTargetCommand('http://127.0.0.1:8080', { platform: 'win32', kind: 'url' }), { command: 'rundll32', args: ['url.dll,FileProtocolHandler', 'http://127.0.0.1:8080'] });
  assert.deepEqual(openTargetCommand('/tmp/x', { platform: 'linux' }), { command: 'xdg-open', args: ['/tmp/x'] });
});

test('the app window is an Edge/Chrome --app window with its own profile', () => {
  const candidates = chromiumCandidates({ platform: 'win32', env: winEnv });
  assert.match(candidates[0], /Microsoft\\Edge\\Application\\msedge\.exe$/);
  assert.ok(candidates.some(item => /Google\\Chrome\\Application\\chrome\.exe$/.test(item)));
  const args = appWindowArgs('http://127.0.0.1:5555', { profileDir: 'C:\\Users\\me\\AppData\\Local\\Contest Publisher\\browser-profile' });
  assert.ok(args.includes('--app=http://127.0.0.1:5555'));
  assert.ok(args.includes('--user-data-dir=C:\\Users\\me\\AppData\\Local\\Contest Publisher\\browser-profile'));
  assert.equal(findChromium({ platform: 'win32', env: winEnv, exists: p => p.includes('Chrome') }), candidates.find(item => item.includes('Chrome')));
  assert.equal(findChromium({ platform: 'win32', env: winEnv, exists: () => false }), null);
});

test('sidecar roots let the packaged binary find assets and the bundled skill', () => {
  const roots = sidecarRoots();
  assert.ok(roots.some(root => root.endsWith('contest-publisher')), `project root missing: ${roots.join(', ')}`);
  const existing = path.join(roots[0], 'assets');
  assert.equal(resolveSidecar('assets', { roots, check: p => p === existing }), existing);
  assert.equal(resolveSidecar('nope', { roots, check: () => false }), null);
});

test('launcher log dir is per platform', () => {
  assert.match(defaultLogDir({ platform: 'win32', env: winEnv }), /Contest Publisher$/);
  assert.match(defaultLogDir({ platform: 'darwin', env: {}, home: '/Users/me' }), /Library\/Logs\/Contest Publisher$/);
  assert.match(defaultProfileDir({ platform: 'win32', env: winEnv }), /browser-profile$/);
});

test('zip extraction falls back to tools each platform ships with', () => {
  const win = zipExtractCommands('C:\\pkg.zip', 'C:\\out', 'win32');
  assert.equal(win[0].command, 'tar');
  assert.deepEqual(win[0].args, ['-xf', 'C:\\pkg.zip', '-C', 'C:\\out']);
  assert.equal(win[1].command, 'powershell');
  assert.match(win[1].args.at(-1), /Expand-Archive -LiteralPath 'C:\\pkg\.zip' -DestinationPath 'C:\\out' -Force/);
  const mac = zipExtractCommands('/tmp/pkg.zip', '/tmp/out', 'darwin');
  assert.equal(mac[0].command, '/usr/bin/ditto');
  assert.equal(mac[1].command, '/usr/bin/unzip');
});

test('zip extraction escapes single quotes for the powershell fallback', () => {
  const [, ps] = zipExtractCommands("C:\\it's.zip", 'C:\\out', 'win32');
  assert.match(ps.args.at(-1), /-LiteralPath 'C:\\it''s\.zip'/);
});

test('git runs with hooks disabled and line-ending rewriting off', () => {
  // core.autocrlf 一旦生效，工作副本的字节就不再等于审计过的字节。
  assert.equal(runGit(['config', '--get', 'core.autocrlf']).trim(), 'false');
  assert.match(runGit(['config', '--get', 'core.hooksPath']).trim(), /dev\/null|no-hooks/);
});

test('a headless console is a windows-only situation', () => {
  assert.equal(isHeadlessConsole({ platform: 'win32', isTTY: undefined }), true);
  assert.equal(isHeadlessConsole({ platform: 'win32', isTTY: true }), false);
  assert.equal(isHeadlessConsole({ platform: 'darwin', isTTY: undefined }), false);
});

function fakeChild({ exitAfterMs = 0, code = 0 }) {
  const handlers = new Map();
  const child = {
    exitCode: null,
    once(event, handler) { handlers.set(event, handler); return child; },
  };
  setTimeout(() => {
    child.exitCode = code;
    handlers.get('exit')?.(code);
  }, exitAfterMs);
  return child;
}

test('a workbench window that stays open ends the session', async () => {
  const opened = [];
  const logs = [];
  const session = await runWorkbenchSession('http://127.0.0.1:1', {
    platform: 'win32',
    minLifetimeMs: 10,
    log: line => logs.push(line),
    open: url => opened.push(url),
    launch: () => ({ child: fakeChild({ exitAfterMs: 40 }), browser: 'msedge.exe' }),
  });
  assert.equal(session.mode, 'app-window');
  assert.equal(session.browser, 'msedge.exe');
  assert.deepEqual(opened, []);
});

test('a launcher that exits immediately falls back to the default browser', async () => {
  const opened = [];
  const session = await runWorkbenchSession('http://127.0.0.1:2', {
    platform: 'win32',
    minLifetimeMs: 5000,
    log: () => {},
    open: url => opened.push(url),
    launch: () => ({ child: fakeChild({ exitAfterMs: 1 }), browser: 'msedge.exe' }),
  });
  assert.equal(session.mode, 'fallback-browser');
  assert.deepEqual(opened, ['http://127.0.0.1:2']);
});

test('no chromium installed still opens the workbench in the default browser', async () => {
  const opened = [];
  const session = await runWorkbenchSession('http://127.0.0.1:3', {
    platform: 'win32',
    log: () => {},
    open: url => opened.push(url),
    launch: () => null,
  });
  assert.equal(session.mode, 'fallback-browser');
  assert.equal(session.reason, 'no-chromium');
  assert.deepEqual(opened, ['http://127.0.0.1:3']);
});

test('macOS keeps opening the default browser and stays in the foreground', async () => {
  const opened = [];
  const session = await runWorkbenchSession('http://127.0.0.1:4', { platform: 'darwin', open: url => opened.push(url), launch: () => assert.fail('macOS must not use the app window') });
  assert.equal(session.mode, 'fallback-browser');
  assert.deepEqual(opened, ['http://127.0.0.1:4']);
});
