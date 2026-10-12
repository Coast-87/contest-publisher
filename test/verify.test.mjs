import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { verifyPrepared } from '../src/verify.mjs';

async function preparedFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contest-verify-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  const original = 'export const ok = false;\n';
  await writeFile(path.join(root, 'src', 'main.js'), original);
  const hash = createHash('sha256').update(original).digest('hex');
  await writeFile(path.join(root, '.contest-publisher-manifest.json'), JSON.stringify({ copied: [{ path: 'src/main.js', kind: 'code', preparedSha256: hash }] }));
  await writeFile(path.join(root, 'README.md'), '# Sample\n');
  await writeFile(path.join(root, 'UPSTREAM.md'), '# Upstream\n');
  await writeFile(path.join(root, 'CONTRIBUTIONS.md'), '# Contributions\n\n## Independently implemented features\n\nAdded input validation.\n\n## Files authored or changed\n\nChanged src/main.js.\n\n## Verification performed\n\nnode --check passed.\n');
  await writeFile(path.join(root, 'src', 'main.js'), 'export const ok = true;\n');
  return root;
}

test('requires original code changes and a completed contribution record, and rejects secrets', async () => {
  const root = await preparedFixture();
  try {
    assert.equal((await verifyPrepared(root)).status, 'passed');
    await writeFile(path.join(root, 'src', 'secret.js'), 'const x = "ghp_123456789012345678901234567890";\n');
    assert.equal((await verifyPrepared(root)).status, 'blocked');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('blocks a source-only copy with no original code delta', async () => {
  const root = await preparedFixture();
  try {
    const original = 'export const ok = false;\n';
    await writeFile(path.join(root, 'src', 'main.js'), original);
    const hash = createHash('sha256').update(original).digest('hex');
    await writeFile(path.join(root, '.contest-publisher-manifest.json'), JSON.stringify({ copied: [{ path: 'src/main.js', kind: 'code', preparedSha256: hash }] }));
    assert.equal((await verifyPrepared(root)).findings.some(x => x.category === 'no-original-code-delta'), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
