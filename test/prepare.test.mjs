import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { auditRun } from '../src/audit.mjs';
import { prepareRun } from '../src/prepare.mjs';
import { reviewFinding } from '../src/review.mjs';
import { runGit } from '../src/process.mjs';
import { exists } from '../src/store.mjs';
import { scanText } from '../src/policy.mjs';
import { writeRunMode } from '../src/state.mjs';
import { verifyPrepared } from '../src/verify.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contest-prepare-'));
  const source = path.join(root, 'source');
  await mkdir(path.join(source, 'src'), { recursive: true });
  await mkdir(path.join(source, 'reports'), { recursive: true });
  await writeFile(path.join(source, 'src', 'main.js'), 'const home = "/Users/alice/project";\nconst contact = "alice@private.test";\n');
  await writeFile(path.join(source, 'reports', 'private.json'), '{"owner":"Alice"}\n');
  await writeFile(path.join(source, 'LICENSE'), 'MIT License\nCopyright Alice\n');
  runGit(['init', '-q', source]);
  runGit(['-C', source, 'add', '-A']);
  runGit(['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  return root;
}

async function resolveFindings(root) {
  const audit = await auditRun(root);
  for (const finding of audit.findings) {
    const decision = finding.category === 'secret' ? 'exclude-file'
      : finding.category === 'environment-path' || finding.category === 'personal-data' ? 'sanitize'
      : finding.disposition === 'retain-attribution' ? 'retain-attribution'
      : finding.category === 'license' ? 'license-reviewed'
      : 'false-positive';
    await reviewFinding(root, { findingId: finding.id, decision, note: 'Reviewed for the fixture test.' });
  }
}

test('prepare requires explicit rights, contest-rule, and audit review gates', async () => {  const root = await fixture();
  try {
    await assert.rejects(prepareRun(root, { name: 'Sample' }), /rights-reviewed/);
    await resolveFindings(root);
    const result = await prepareRun(root, { name: 'Sample', rightsReviewed: true, contestRulesReviewed: true });
    assert.equal(result.manifest.copied.some(x => x.path === 'src/main.js'), true);
    assert.equal(result.manifest.copied.some(x => x.path === 'LICENSE'), true);
    assert.equal(result.manifest.excluded.some(x => x.path === 'reports/private.json'), true);
    const output = await readFile(path.join(root, 'work', 'src', 'main.js'), 'utf8');
    assert.equal(output.includes('/Users/alice'), false);
    assert.equal(output.includes('alice@private.test'), false);
    assert.equal(output.includes('maintainer@example.invalid'), true);
    assert.equal((await readFile(path.join(root, 'work', 'UPSTREAM.md'), 'utf8')).trim(), '此为大赛提交所建');
  } finally { await rm(root, { recursive: true, force: true }); }
});

// 密钥没有"确认放行"：唯一合法处置是把该文件排除出副本。这样流程能继续，凭证也绝不会被提交。
test('secret findings can only be resolved by excluding the file', async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, 'source', 'src', 'secret.js'), 'const token = "ghp_123456789012345678901234567890";');
    runGit(['-C', path.join(root, 'source'), 'add', '-A']);
    runGit(['-C', path.join(root, 'source'), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'add secret']);
    const audit = await auditRun(root);
    const secret = audit.findings.find(x => x.category === 'secret');
    assert.ok(secret, 'the token is reported');
    await assert.rejects(reviewFinding(root, { findingId: secret.id, decision: 'false-positive', note: 'ignore' }), /not allowed for secret/);
    await assert.rejects(reviewFinding(root, { findingId: secret.id, decision: 'sanitize', note: 'ignore' }), /not allowed for secret/);
    await assert.rejects(prepareRun(root, { name: 'Sample', rightsReviewed: true, contestRulesReviewed: true }), /unresolved review finding/);

    await reviewFinding(root, { findingId: secret.id, decision: 'exclude-file', note: '含凭证，排除出副本' });
    await resolveFindings(root);
    await prepareRun(root, { name: 'Sample', rightsReviewed: true, contestRulesReviewed: true });
    assert.equal(await exists(path.join(root, 'work', 'src', 'secret.js')), false, 'the credential file never enters the copy');
    const verify = await verifyPrepared(path.join(root, 'work'), { allowCopy: true });
    assert.equal(verify.findings.some(item => item.category === 'secret'), false, 'no secret left in the copy');
  } finally { await rm(root, { recursive: true, force: true }); }
});

// 测试夹具里的假凭证（test-password / secret-value / client_secret: 'secret-n2'）不该报密钥，
// 否则真实项目的测试目录会把流程整段卡死。
test('test-fixture credential values are not reported as secrets', () => {
  const fixtureLines = [
    "client_secret: 'secret-value',",
    'const password = "test-password";',
    "apiKey: 'dummy-token-1234',",
  ].join('\n');
  assert.equal(scanText('src/a.test.ts', fixtureLines).some(f => f.category === 'secret'), false);
  // 真实的高熵凭证仍然照报。
  const real = scanText('src/b.ts', 'const token = "ghp_123456789012345678901234567890";');
  assert.equal(real.some(f => f.category === 'secret'), true);
});

test('a contact inside a retained attribution file is kept verbatim, not rewritten', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contest-prepare-'));
  try {
    const source = path.join(root, 'source');
    await mkdir(path.join(source, 'src'), { recursive: true });
    await writeFile(path.join(source, 'src', 'main.js'), 'export const answer = 42;\n');
    const license = 'MIT License\n\nCopyright (c) 2024 Alice <alice@corp-mail.io>\n';
    await writeFile(path.join(source, 'LICENSE'), license);
    runGit(['init', '-q', source]);
    runGit(['-C', source, 'add', '-A']);
    runGit(['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);

    const audit = await auditRun(root);
    const finding = audit.findings.find(item => item.disposition === 'retain-attribution');
    assert.equal(finding.category, 'personal-data');
    // sanitize would rewrite a legal notice and false-positive would record a false statement.
    await reviewFinding(root, { findingId: finding.id, decision: 'retain-attribution', note: '归属文件按原样保留。' });

    const result = await prepareRun(root, { name: 'Sample', rightsReviewed: true, contestRulesReviewed: true });
    assert.equal(result.manifest.copied.some(item => item.path === 'LICENSE'), true);
    assert.equal(await readFile(path.join(root, 'work', 'LICENSE'), 'utf8'), license);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// 赛题验收标准可能要求仓库里带报告/看板产物——这些默认被当作运行产物排除，
// 显式保留后必须进入副本，且安全门禁（密钥、脱敏）照旧。
test('kept paths bring policy-excluded deliverables into the work copy', async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, 'source', 'reports', 'daily.md'), '# Daily\n\n生成于 /Users/alice/trending\n');
    await mkdir(path.join(root, 'source', 'reports', 'dashboard'), { recursive: true });
    await writeFile(path.join(root, 'source', 'reports', 'dashboard', 'index.html'), '<!doctype html><title>Dashboard</title>\n');
    await writeFile(path.join(root, 'source', 'reports', 'dashboard', 'hero.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
    runGit(['-C', path.join(root, 'source'), 'add', '-A']);
    runGit(['-C', path.join(root, 'source'), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'reports']);

    await resolveFindings(root);
    const prepared = await prepareRun(root, { name: 'Sample', keepPaths: ['reports'], rightsReviewed: true, contestRulesReviewed: true });
    const work = path.join(root, 'work');

    assert.deepEqual(prepared.manifest.keepPaths, ['reports']);
    assert.equal(prepared.manifest.copied.some(item => item.path === 'reports/daily.md' && item.kept === true), true);
    assert.equal(prepared.manifest.copied.some(item => item.path === 'reports/dashboard/hero.png' && item.binary === true), true);
    assert.equal(prepared.manifest.excluded.some(item => item.path.startsWith('reports/')), false, 'kept paths leave the excluded list');

    // 保留的文本仍然脱敏（本机路径被替换），不是原样搬运。
    const daily = await readFile(path.join(work, 'reports', 'daily.md'), 'utf8');
    assert.equal(daily.includes('/Users/alice'), false);
    assert.match(daily, /\$\{PROJECT_ROOT\}/);

    // 副本校验放行保留产物（含二进制），但密钥仍然硬阻断。
    await writeRunMode(root, 'copy', 're-publish');
    assert.equal((await verifyPrepared(work, { allowCopy: true })).status, 'passed');
    await writeFile(path.join(work, 'reports', 'leak.md'), 'token = "ghp_123456789012345678901234567890"\n');
    const blocked = await verifyPrepared(work, { allowCopy: true });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.findings.some(item => item.category === 'secret' && item.disposition === 'block'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// 电话样式数字串：扫描报 personal-data，脱敏就必须能改掉，否则副本里残留 → 验证阻断（真事故）。
test('phone-like values are redacted so the copy passes verification', async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, 'source', 'src', 'demo.js'), 'export const demoPhone = "13800138000";\n');
    runGit(['-C', path.join(root, 'source'), 'add', '-A']);
    runGit(['-C', path.join(root, 'source'), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'phone']);
    await resolveFindings(root);
    await prepareRun(root, { name: 'Sample', rightsReviewed: true, contestRulesReviewed: true });
    const copied = await readFile(path.join(root, 'work', 'src', 'demo.js'), 'utf8');
    assert.equal(copied.includes('13800138000'), false);
    assert.match(copied, /\[REDACTED_PHONE\]/);
    await writeRunMode(root, 'copy');
    assert.equal((await verifyPrepared(path.join(root, 'work'), { allowCopy: true })).status, 'passed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
