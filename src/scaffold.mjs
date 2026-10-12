import path from 'node:path';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { exists, readJson } from './store.mjs';

const LANGUAGE_BY_EXTENSION = {
  '.mjs': 'js', '.js': 'js', '.cjs': 'js', '.ts': 'js', '.jsx': 'js', '.tsx': 'js', '.vue': 'js', '.svelte': 'js',
  '.py': 'py',
  '.sh': 'sh', '.bash': 'sh', '.zsh': 'sh',
};

const ENTRY_BY_LANGUAGE = { js: 'index.mjs', py: 'solution.py', sh: 'solution.sh' };

async function listCodeExtensions(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await listCodeExtensions(root, child));
    else if (entry.isFile()) found.push(child);
  }
  return found;
}

/** Pick a scaffold language from what the work copy already contains (defaults to JavaScript). */
export async function detectLanguage(runDir) {
  const work = path.join(path.resolve(runDir), 'work');
  const counts = new Map();
  for (const relative of await listCodeExtensions(work)) {
    const language = LANGUAGE_BY_EXTENSION[path.extname(relative).toLowerCase()];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? 'js';
}

function jsEntry(name, problem) {
  return `#!/usr/bin/env node
// ${name} — 赛题实现入口${problem ? `（${problem}）` : ''}
//
// 这个文件是脚手架：结构、参数解析和自检都齐了，逻辑在 solve() 里等你实现。
// 实现步骤：
//   1. 把 solve() 里的 TODO 换成你的实现
//   2. node solution/self-test.mjs 自检
//   3. 回工作台点「运行验证」，然后走一键推送 / 提交
import { readFile } from 'node:fs/promises';

/**
 * 赛题入口：读入输入，返回输出。
 * @param {string} input 原始输入文本
 * @returns {Promise<string>|string} 结果文本
 */
export async function solve(input) {
  throw new Error('TODO: 在这里实现赛题逻辑（输入输出格式见赛题页）');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(argv) {
  const fileFlag = argv.indexOf('--input');
  const input = fileFlag >= 0 ? await readFile(argv[fileFlag + 1], 'utf8') : argv.includes('--stdin') || !process.stdin.isTTY ? await readStdin() : '';
  const output = await solve(input);
  process.stdout.write(output.endsWith('\\n') ? output : output + '\\n');
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(\`ERROR: \${error.message}\\n\`);
    process.exitCode = 1;
  });
}
`;
}

function jsSelfTest(name) {
  return `import assert from 'node:assert/strict';
import { solve } from './index.mjs';

// 自检：先用赛题页给的样例把这里替换掉，实现完成后应当全部通过。
const samples = [
  // { input: '样例输入', expected: '样例输出' },
];

assert.equal(typeof solve, 'function', 'solve 必须导出');
for (const [index, sample] of samples.entries()) {
  const actual = await solve(sample.input);
  assert.equal(String(actual).trim(), String(sample.expected).trim(), \`样例 \${index + 1} 不匹配\`);
}
console.log(\`self-test: \${samples.length} 个样例通过\`);
`;
}

function pyEntry(name, problem) {
  return `#!/usr/bin/env python3
"""${name} — 赛题实现入口${problem ? `（${problem}）` : ''}

脚手架：读写和自检骨架已就位，逻辑在 solve() 里实现。
  1. 替换 solve() 里的 TODO
  2. python3 solution/${name}.py --self-test
"""
import sys


def solve(text: str) -> str:
    """赛题入口：输入文本 -> 输出文本。"""
    raise NotImplementedError("TODO: 在这里实现赛题逻辑（输入输出格式见赛题页）")


def main(argv):
    if "--self-test" in argv:
        print("self-test: 还没有样例，先在 solution/${name}.py 里加样例")
        return 0
    text = open(argv[argv.index("--input") + 1], encoding="utf-8").read() if "--input" in argv else sys.stdin.read()
    sys.stdout.write(solve(text))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except NotImplementedError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
`;
}

function shEntry(name, problem) {
  return `#!/usr/bin/env bash
# ${name} — 赛题实现入口${problem ? `（${problem}）` : ''}
#
# 脚手架：参数解析和错误处理已就位，逻辑在 run_solution() 里实现。
#   1. 替换 run_solution() 里的 TODO
#   2. bash solution/${name}.sh --self-test
set -euo pipefail

usage() {
  cat <<'USAGE'
用法: solution.sh [--input FILE] [--self-test]
  --input FILE   从文件读取输入（默认 stdin）
  --self-test    运行自检
USAGE
}

run_solution() {
  # TODO: 在这里实现赛题逻辑（输入来自 $1，结果写到 stdout）
  echo "TODO: 赛题逻辑尚未实现" >&2
  return 1
}

main() {
  local input=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --self-test) echo "self-test: 还没有样例，先在这里加断言"; return 0 ;;
      --input) input="\${2:?--input 需要一个文件参数}"; shift 2 ;;
      -h|--help) usage; return 0 ;;
      *) echo "未知参数: $1" >&2; usage >&2; return 2 ;;
    esac
  done
  local payload
  payload="$(if [[ -n "$input" ]]; then cat "$input"; else cat; fi)"
  run_solution "$payload"
}

main "$@"
`;
}

/**
 * Write a runnable starter implementation into work/ so the author has a real place to put the
 * logic instead of a blank page. The scaffold parses/loads cleanly but does not implement the
 * problem: judging runs the real competition cases, so only a filled-in implementation scores.
 */
export async function scaffoldRun(runDir, { lang, name = 'solution', force = false } = {}) {
  const root = path.resolve(runDir);
  const work = path.join(root, 'work');
  if (!(await exists(work))) throw new Error(`Run has no work copy yet: ${work}`);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('脚手架名称只允许字母、数字、点、下划线、连字符');
  const language = lang ?? await detectLanguage(root);
  if (!ENTRY_BY_LANGUAGE[language]) throw new Error(`Unsupported scaffold language: ${language}（可选 js / py / sh）`);

  let problem = null;
  try { problem = (await readJson(path.join(root, 'evidence', 'selected-problem.json'))).problemName; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const files = [];
  const write = async (relative, content, mode) => {
    const target = path.join(work, ...relative.split('/'));
    if (!force && await exists(target)) throw new Error(`脚手架文件已存在: ${relative}（用 --force 覆盖）`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, mode ? { encoding: 'utf8', mode } : 'utf8');
    files.push(relative);
  };

  if (language === 'js') {
    await write(`solution/${ENTRY_BY_LANGUAGE.js}`, jsEntry(name, problem));
    await write('solution/self-test.mjs', jsSelfTest(name));
  } else if (language === 'py') {
    await write(`solution/${ENTRY_BY_LANGUAGE.py}`, pyEntry(name, problem), 0o755);
  } else {
    await write(`solution/${ENTRY_BY_LANGUAGE.sh}`, shEntry(name, problem), 0o755);
  }

  return {
    language,
    problem,
    files,
    next: language === 'js' ? 'node solution/self-test.mjs'
      : language === 'py' ? `python3 solution/${ENTRY_BY_LANGUAGE.py} --self-test`
      : `bash solution/${ENTRY_BY_LANGUAGE.sh} --self-test`,
    note: '脚手架只是起点：判题会真跑赛题用例，占位实现拿不到分。填完逻辑后点「运行验证」。',
  };
}
