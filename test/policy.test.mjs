import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPath, isKeptPath, normalizeKeepPaths, scanText } from '../src/policy.mjs';

test('classifies source, build metadata, attribution, and personal artifacts separately', () => {
  assert.equal(classifyPath('src/index.ts').kind, 'code');
  assert.equal(classifyPath('package-lock.json').kind, 'build');
  assert.equal(classifyPath('.gitignore').kind, 'build');
  assert.equal(classifyPath('LICENSE').kind, 'attribution');
  assert.equal(classifyPath('reports/daily.json').kind, 'exclude');
  // IaC / 部署清单是赛题交付的源代码，漏掉会把整个包复制成空的。
  assert.equal(classifyPath('main.tf').kind, 'code');
  assert.equal(classifyPath('terraform.tfvars').kind, 'code');
  assert.equal(classifyPath('k8s/deploy.yaml').kind, 'code');
  assert.equal(classifyPath('.env.production').kind, 'review');
});

// 赛题验收可能要求仓库里带报告/看板产物，所以排除规则要能被显式覆盖。
test('normalizes keep paths from lines, commas, and trailing slashes', () => {
  assert.deepEqual(normalizeKeepPaths('reports/\ndashboard/\nscheduler/execution-record.log'), ['reports', 'dashboard', 'scheduler/execution-record.log']);
  assert.deepEqual(normalizeKeepPaths(['reports/', ' reports ', '', '  ']), ['reports']);
  assert.deepEqual(normalizeKeepPaths(undefined), []);
  assert.deepEqual(normalizeKeepPaths('../evil'), [], 'path escapes are dropped');
});

test('matches kept directories and files, but not sibling prefixes', () => {
  const keep = normalizeKeepPaths(['reports', 'scheduler/execution-record.log']);
  assert.equal(isKeptPath('reports/dashboard/index.html', keep), true);
  assert.equal(isKeptPath('reports', keep), true);
  assert.equal(isKeptPath('scheduler/execution-record.log', keep), true);
  assert.equal(isKeptPath('scheduler/other.log', keep), false);
  assert.equal(isKeptPath('reports-archive/x.md', keep), false, 'prefix must be a path segment');
  assert.equal(isKeptPath('src/main.js', keep), false);
  assert.equal(isKeptPath('src/main.js', []), false);
});

test('detects credential-like values but ignores obvious placeholders', () => {
  const findings = scanText('config.js', `const token = "ghp_123456789012345678901234567890";\nconst demo = "your_api_key_here";`);
  assert.equal(findings.some(f => f.category === 'secret'), true);
  assert.equal(findings.some(f => f.evidence.includes('your_api_key_here')), false);
});

test('flags contact details and absolute personal paths as review findings', () => {
  const findings = scanText('src/config.ts', `const contact = "person@private.test";\nconst home = "/Users/alice/work";`);
  assert.equal(findings.some(f => f.category === 'personal-data'), true);
  // RFC 2606 保留域是文档/测试占位，不算个人信息（与 prepare 的脱敏口径一致）。
  const placeholders = scanText('src/test.ts', `const email = "user@example.com";\nconst other = "x@example.org";\nconst third = "y@invalid";`);
  assert.equal(placeholders.some(f => f.category === 'personal-data'), false);
  assert.equal(findings.some(f => f.category === 'environment-path'), true);
});

test('preserves license files and does not classify them as personal project artifacts', () => {
  assert.equal(classifyPath('third_party/LICENSE-MIT').kind, 'attribution');
  assert.equal(classifyPath('NOTICE.txt').kind, 'attribution');
});

test('keeps project documentation, including the upstream README', () => {
  assert.equal(classifyPath('README.md').kind, 'docs');
  assert.equal(classifyPath('README').kind, 'docs');
  assert.equal(classifyPath('readme.rst').kind, 'docs');
  assert.equal(classifyPath('docs/guide.md').kind, 'docs', 'a docs/ directory is documentation, not runtime output');
  assert.equal(classifyPath('references/iam-policies.md').kind, 'docs');
  assert.equal(classifyPath('SKILL.md').kind, 'docs');
  assert.equal(classifyPath('CHANGELOG.md').kind, 'docs');
  // Runtime output and reports are still dropped.
  assert.equal(classifyPath('reports/daily.json').kind, 'exclude');
  assert.equal(classifyPath('logs/run.txt').kind, 'exclude');
  assert.equal(classifyPath('dist/bundle.js').kind, 'exclude');
});
