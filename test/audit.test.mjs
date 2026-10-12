import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { auditRun } from '../src/audit.mjs';
import { runGit } from '../src/process.mjs';

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contest-audit-'));
  const source = path.join(root, 'source');
  await mkdir(source);
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(source, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  runGit(['init', '-q', source]);
  runGit(['-C', source, 'add', '-A']);
  runGit(['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  return { root, source };
}

test('audits tracked files, excludes reports, and finds review items without leaking secrets', async () => {
  const f = await fixture({
    'src/main.ts': 'export const title = "hello";\n',
    'reports/daily.json': '{"name":"private report"}',
    'LICENSE': 'MIT License\nCopyright 2026 Example\n',
    'src/credential.ts': 'const token = "ghp_123456789012345678901234567890";\n',
  });
  try {
    const result = await auditRun(f.root);
    // 密钥是"必须排除该文件"的可审查项（唯一合法决定 exclude-file），不再是无法继续的硬阻断。
    assert.equal(result.summary.status, 'review_required');
    const secret = result.findings.find(x => x.category === 'secret');
    assert.ok(secret, 'the token is reported');
    assert.equal(secret.disposition, 'review');
    assert.equal(result.findings.some(x => x.category === 'secret' && x.disposition === 'block'), false);
    assert.equal(result.files.find(x => x.path === 'reports/daily.json').kind, 'exclude');
    assert.equal(JSON.stringify(result).includes('ghp_123456789012345678901234567890'), false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('requires human review when the source has no license and reports personal contact data', async () => {
  // 用非保留域（example.com 属 RFC 2606 占位域，扫描侧按占位处理，见 policy.test）。
  const f = await fixture({ 'src/main.py': 'CONTACT = "person@private.test"\n' });
  try {
    const result = await auditRun(f.root);
    assert.equal(result.summary.status, 'review_required');
    assert.equal(result.findings.some(x => x.category === 'license'), true);
    assert.equal(result.findings.some(x => x.category === 'personal-data'), true);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
