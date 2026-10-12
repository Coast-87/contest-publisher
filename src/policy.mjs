import path from 'node:path';

const CODE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.graphql', '.h', '.hpp', '.html',
  '.java', '.js', '.jsx', '.kt', '.mjs', '.php', '.py', '.rb', '.rs', '.scss',
  '.sql', '.svelte', '.ts', '.tsx', '.vue', '.wasm', '.sh', '.bash', '.zsh',
  // IaC / 部署配置也是赛题交付的源代码（Terraform、k8s、CI 清单），漏掉会让整个包变空。
  '.tf', '.tfvars', '.hcl', '.yaml', '.yml', '.toml',
]);
const BUILD_FILES = new Set([
  'bun.lock', 'bun.lockb', 'cargo.lock', 'go.mod', 'go.sum', 'makefile',
  'package-lock.json', 'package.json', 'pnpm-lock.yaml', 'pom.xml',
  'pyproject.toml', 'requirements.txt', 'rust-toolchain', 'tsconfig.json',
  'yarn.lock', 'dockerfile', '.dockerignore', '.editorconfig', '.gitignore',
]);
const ATTRIBUTION_NAMES = /^(license|licence|copying|notice|copyright|third[_-]?party)([-_.].*)?$/i;
// Project documentation is kept: without it nobody can tell what the project is. Runtime output,
// reports and generated trees are still dropped, and README is replaced by the transparent one.
const DOC_EXTENSIONS = new Set(['.md', '.markdown', '.rst', '.txt', '.adoc']);
// Documentation is kept verbatim — including the upstream README, which is the first thing that
// tells anyone what the project is. Only sensitive content is filtered (audit findings), and only
// runtime output (reports/logs/dist/...) is dropped.
const DOC_NAMES = /^(readme|changelog|contributing|authors|history|install|usage|manual|notes?)(\.[a-z0-9]+)?$/i;
const PERSONAL_OR_RUNTIME_DIRS = new Set([
  '.git', '.github', '.gitlab', '.idea', '.vscode', 'assets', 'build', 'cache',
  'coverage', 'data', 'dist', 'examples', 'logs', 'node_modules',
  'reports', 'screenshots', 'tmp', 'uploads',
]);
const REVIEW_NAMES = /^\.env(?:\..*)?$|^(config|settings|secrets?)(\..*)?$/i;
const PLACEHOLDER = /^(?:<[^>]+>|\$\{[^}]+\}|your[_-].*|change[-_]?me.*|replace[-_]?me.*|example.*|sample.*|dummy.*|placeholder.*|test(?:ing)?|null|undefined|none)$/i;
// prepare 脱敏时写下的占位符：verify 会重新扫描副本，这些标记不能反过来触发阻断。
const SANITIZED_EMAIL_PLACEHOLDER = 'maintainer@example.invalid';
// RFC 2606 保留域（example.com/org/net 及其子域、.invalid、.test）：文档与测试里的占位地址。
// 扫描与脱敏必须共用这一口径——扫描报了却脱敏不掉，流程就会卡在"两边都不让过"。
const RESERVED_EMAIL_DOMAIN = /@(?:[A-Za-z0-9-]+\.)*(?:example\.(?:com|org|net)|invalid)$/i;
export function isPlaceholderEmail(address) {
  const value = String(address ?? '');
  return value.toLowerCase() === SANITIZED_EMAIL_PLACEHOLDER || RESERVED_EMAIL_DOMAIN.test(value);
}
// 电话样式的数字串：扫描（报告）与脱敏（替换）共用同一来源，避免"报了却改不掉"。
const PHONE_SOURCE = String.raw`(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)|(?<!\d)\+?1?[- .]?\(?\d{3}\)?[- .]\d{3}[- .]\d{4}(?!\d)`;
export const newPhonePattern = () => new RegExp(PHONE_SOURCE, 'g');

export function normalizeRelativePath(input) {
  const normalized = path.posix.normalize(String(input).replaceAll('\\', '/')).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new Error(`Invalid relative path: ${input}`);
  }
  return normalized;
}

// 额外保留的源路径。报告 / 看板 / 运行记录在有些赛题里就是验收要看的交付物，
// 运营把这些路径显式声明为保留后，排除规则不再适用（密钥扫描等安全门禁仍然生效）。
// 每项可以是目录（`reports`，含其下全部文件）或具体文件；容忍换行/逗号分隔与结尾斜杠。
export function normalizeKeepPaths(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[\n,]/);
  const out = [];
  for (const item of raw) {
    const trimmed = String(item ?? '').trim().replace(/\/+$/, '');
    if (!trimmed) continue;
    let normalized;
    try { normalized = normalizeRelativePath(trimmed); } catch { continue; }
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

export function isKeptPath(relative, keepPaths) {
  if (!keepPaths?.length) return false;
  let normalized;
  try { normalized = normalizeRelativePath(relative); } catch { return false; }
  return keepPaths.some(entry => normalized === entry || normalized.startsWith(`${entry}/`));
}

export function classifyPath(input) {
  const relative = normalizeRelativePath(input);
  const parts = relative.split('/');
  const base = parts.at(-1);
  const lowerBase = base.toLowerCase();
  if (parts.some(part => PERSONAL_OR_RUNTIME_DIRS.has(part.toLowerCase()))) {
    return { kind: 'exclude', reason: 'generated-or-non-source directory' };
  }
  if (ATTRIBUTION_NAMES.test(base)) return { kind: 'attribution', reason: 'preserve provenance and license' };
  if (REVIEW_NAMES.test(base)) return { kind: 'review', reason: 'configuration may contain private values' };
  if (base.startsWith('.') && !['.dockerignore', '.editorconfig', '.gitignore'].includes(lowerBase)) {
    return { kind: 'exclude', reason: 'hidden project metadata' };
  }
  const ext = path.posix.extname(lowerBase);
  if (CODE_EXTENSIONS.has(ext)) return { kind: 'code', reason: 'source file' };
  if (DOC_EXTENSIONS.has(ext) || DOC_NAMES.test(base)) return { kind: 'docs', reason: 'project documentation kept for readability' };
  if (BUILD_FILES.has(lowerBase)) return { kind: 'build', reason: 'build metadata' };
  return { kind: 'exclude', reason: 'not in the code/documentation allowlist' };
}

function redactPersonal(value) {
  return value.replace(/([A-Z0-9._%+-]{1,3})[A-Z0-9._%+-]*(@[A-Z0-9.-]+\.[A-Z]{2,})/i, '$1***$2').replace(/\/(?:Users|home)\/[^/\s]+/g, '/<USER>').replace(/\+?\d[\d .()-]{8,}\d/g, '[REDACTED_PHONE]');
}

function addFinding(findings, category, file, pattern, evidence) {
  findings.push({
    id: `${category}:${file}:${findings.length + 1}`,
    category,
    file,
    pattern,
    evidence: category === 'secret' ? '[REDACTED]' : category === 'personal-data' ? redactPersonal(evidence) : evidence.slice(0, 120),
    // 密钥不是"可以确认后放行"，而是"必须把该文件排除出副本"——唯一合法决定是 exclude-file，
    // 因此记为 review（给出口）而不是 block（无出口）；verify 仍会硬拦副本里的任何密钥。
    disposition: 'review',
  });
}

function isPlaceholder(value) {
  const cleaned = value.trim().replace(/^['"`]|['"`]$/g, '');
  return PLACEHOLDER.test(cleaned) || looksLikeFixture(cleaned);
}

// 测试夹具 / 占位取值：test-password、secret-value、dummy-token、client_secret: 'secret-n2'……
// 这类值不可能是真实凭证（真实凭证是高熵随机串），命中关键词或低熵短串时不再报密钥。
const FIXTURE_WORDS = /(?:test|fake|dummy|mock|sample|example|placeholder|change[-_]?me|secret|password|passwd|token|invalid|notreal|redacted|xxxx|1234|abcd|n\/a)/i;
function shannonEntropy(text) {
  const counts = new Map();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
function looksLikeFixture(value) {
  if (!value || value.length < 8) return false;
  if (FIXTURE_WORDS.test(value)) return true;
  return value.length < 24 && shannonEntropy(value) < 3;
}

export function scanText(file, text) {
  const findings = [];
  const seen = new Set();
  const record = (category, pattern, evidence) => {
    const key = `${category}:${pattern}:${evidence}`;
    if (seen.has(key)) return;
    seen.add(key);
    addFinding(findings, category, file, pattern, evidence);
  };
  const patterns = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
    ['token-prefix', /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/g],
    ['credential-url', /https?:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/gi],
  ];
  for (const [name, regex] of patterns) {
    for (const match of text.matchAll(regex)) record('secret', name, match[0]);
  }

  const assignment = /\b(api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|security[_-]?token)\b\s*[:=]\s*(["'`])([^"'`\n]{8,})\2/gi;
  for (const match of text.matchAll(assignment)) {
    if (!isPlaceholder(match[3])) record('secret', 'credential-assignment', `${match[1]}=${match[3]}`);
  }

  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  for (const match of text.matchAll(email)) {
    if (isPlaceholderEmail(match[0])) continue;
    record('personal-data', 'email', match[0]);
  }

  const personalPath = /\/(?:Users|home)\/([A-Za-z0-9._-]+)(?:\/|\b)|\/root\//g;
  for (const match of text.matchAll(personalPath)) record('environment-path', 'absolute-user-path', match[0]);

  for (const match of text.matchAll(newPhonePattern())) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) record('personal-data', 'phone-like', match[0]);
  }

  const markers = /(?:copyright\s+©?\s*\d{4}[^\n]{0,100}|(?:author|maintainer|contact)\s*[:=]\s*[^\n]{2,100})/gi;
  for (const match of text.matchAll(markers)) {
    if (match[0].includes(SANITIZED_EMAIL_PLACEHOLDER) || match[0].includes('${PROJECT_ROOT}')) continue;
    record('project-identity', 'authorship-marker', match[0]);
  }

  return findings;
}

export function summarizeFindings(findings) {
  const counts = Object.fromEntries(['secret', 'personal-data', 'environment-path', 'project-identity'].map(category => [
    category,
    findings.filter(item => item.category === category).length,
  ]));
  const blocked = findings.some(item => item.disposition === 'block');
  const needsReview = findings.some(item => item.disposition === 'review');
  return {
    counts,
    status: blocked ? 'blocked' : needsReview ? 'review_required' : 'passed',
  };
}
