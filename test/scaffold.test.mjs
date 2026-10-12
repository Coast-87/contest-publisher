import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { auditRun } from '../src/audit.mjs';
import { prepareRun } from '../src/prepare.mjs';
import { reviewFinding } from '../src/review.mjs';
import { verifyPrepared } from '../src/verify.mjs';
import { detectLanguage, scaffoldRun } from '../src/scaffold.mjs';
import { writeContributionRecord } from '../src/prepare.mjs';
import { writeRunMode } from '../src/state.mjs';
import { runGit } from '../src/process.mjs';

async function fixture({ readme } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contest-scaffold-'));
  const source = path.join(root, 'source');
  await mkdir(path.join(source, 'scheduler'), { recursive: true });
  await writeFile(path.join(source, 'scheduler', 'daily.sh'), '#!/bin/bash\necho daily\n');
  await writeFile(path.join(source, 'LICENSE'), 'MIT License\n\nCopyright (c) 2024 Alice\n');
  if (readme) await writeFile(path.join(source, 'README.md'), readme);
  runGit(['init', '-q', source]);
  runGit(['-C', source, 'add', '-A']);
  runGit(['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const audit = await auditRun(root);
  for (const finding of audit.findings) {
    const decision = finding.disposition === 'retain-attribution' ? 'retain-attribution'
      : finding.category === 'license' ? 'license-reviewed'
      : 'false-positive';
    await reviewFinding(root, { findingId: finding.id, decision, note: 'scaffold fixture' });
  }
  await prepareRun(root, { name: 'Sample', rightsReviewed: true, contestRulesReviewed: true });
  return root;
}

test('scaffold satisfies the delta rule and verify no longer gates on CONTRIBUTIONS.md', async () => {
  const root = await fixture();
  try {
    const work = path.join(root, 'work');
    assert.equal(await detectLanguage(root), 'sh', 'language follows the source the work copy already has');

    const scaffold = await scaffoldRun(root, { lang: 'js' });
    assert.deepEqual(scaffold.files, ['solution/index.mjs', 'solution/self-test.mjs']);
    assert.match(await readFile(path.join(work, 'solution', 'index.mjs'), 'utf8'), /TODO: 在这里实现赛题逻辑/);

    // CONTRIBUTIONS.md is still the prepare stub, and that is no longer a finding.
    const result = await verifyPrepared(work);
    assert.equal(result.codeDelta.some(item => item.path === 'solution/index.mjs'), true);
    assert.equal(result.syntaxChecked.includes('solution/index.mjs'), true, 'node --check accepts the scaffold');
    assert.deepEqual(result.findings, []);
    assert.equal(result.status, 'passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the upstream README is documentation and survives preparation', async () => {
  const readme = '# Real Project\n\nThis project does the thing, explained for humans.\n';
  const root = await fixture({ readme });
  try {
    const work = path.join(root, 'work');
    assert.equal(await readFile(path.join(work, 'README.md'), 'utf8'), readme, 'kept verbatim, not replaced by the generated stub');
    const manifest = JSON.parse(await readFile(path.join(root, 'evidence', 'prepare.json'), 'utf8'));
    assert.equal(manifest.copied.find(item => item.path === 'README.md')?.kind, 'docs');
    assert.equal(manifest.excluded.some(item => item.path === 'README.md'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a README is generated only when the source has none', async () => {
  const root = await fixture();
  try {
    const generated = await readFile(path.join(root, 'work', 'README.md'), 'utf8');
    assert.match(generated, /This repository contains the executable source and build configuration/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('documentation may name its maintainers but never carries secrets', async () => {
  const root = await fixture();
  try {
    const work = path.join(root, 'work');
    await writeFile(path.join(work, 'docs-notes.md'), '# Notes\n\nMaintainer: alice@acme-corp.io\n', 'utf8');
    let result = await verifyPrepared(work);
    assert.equal(result.findings.some(item => item.category === 'personal-data'), false);

    await writeFile(path.join(work, 'docs-notes.md'), '# Notes\n\nkey = "ghp_123456789012345678901234567890"\n', 'utf8');
    result = await verifyPrepared(work);
    assert.equal(result.findings.some(item => item.category === 'secret' && item.disposition === 'block'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('copy mode waives the delta rule and the tool writes CONTRIBUTIONS.md itself', async () => {
  const root = await fixture();
  try {
    const work = path.join(root, 'work');
    await writeRunMode(root, 'copy', 're-publish upstream as-is');

    const record = await writeContributionRecord(root);
    assert.equal(record.written, true);
    const contributions = await readFile(path.join(work, 'CONTRIBUTIONS.md'), 'utf8');
    assert.equal((contributions.match(/此为大赛提交所建/g) ?? []).length, 4, '四个章节都是同一句');
    assert.doesNotMatch(contributions, /TODO/);

    const copied = await verifyPrepared(work, { allowCopy: true });
    assert.equal(copied.status, 'passed');
    assert.equal(copied.mode, 'copy');
    assert.equal(copied.findings.some(item => item.category === 'no-original-code-delta' && item.disposition === 'waived'), true);

    // The same work copy still fails the strict policy.
    const strict = await verifyPrepared(work);
    assert.equal(strict.status, 'blocked');
    assert.equal(strict.findings.some(item => item.category === 'no-original-code-delta' && item.disposition === 'block'), true);

    // A human-written record is never overwritten.
    await writeFile(path.join(work, 'CONTRIBUTIONS.md'), '# mine\n', 'utf8');
    assert.equal((await writeContributionRecord(root, { mode: 'copy' })).written, false);
    assert.equal(await readFile(path.join(work, 'CONTRIBUTIONS.md'), 'utf8'), '# mine\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('copy mode only waives the delta rule — every other gate still blocks', async () => {
  const root = await fixture();
  try {
    const work = path.join(root, 'work');
    await writeRunMode(root, 'copy');
    await writeContributionRecord(root);
    assert.equal((await verifyPrepared(work, { allowCopy: true })).status, 'passed');

    // 8. a stray non-allowlisted file is still an unexpected-file block
    await writeFile(path.join(work, 'design.pdf'), '%PDF-1.4 not really a pdf\n', 'utf8');
    let result = await verifyPrepared(work, { allowCopy: true });
    assert.equal(result.status, 'blocked');
    assert.equal(result.findings.some(item => item.category === 'unexpected-file' && item.disposition === 'block'), true);
    await rm(path.join(work, 'design.pdf'));

    // 9. a secret in a source file is still a block
    await writeFile(path.join(work, 'scheduler', 'leak.sh'), 'token="ghp_123456789012345678901234567890"\n', 'utf8');
    result = await verifyPrepared(work, { allowCopy: true });
    assert.equal(result.status, 'blocked');
    assert.equal(result.findings.some(item => item.category === 'secret' && item.disposition === 'block'), true);
    await rm(path.join(work, 'scheduler', 'leak.sh'));

    // 10. a syntax error still stops verification
    await writeFile(path.join(work, 'broken.mjs'), 'export const = ;\n', 'utf8');
    await assert.rejects(verifyPrepared(work, { allowCopy: true }), /exited 1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('records written by an older build are refreshed to the current wording', async () => {
  const root = await fixture();
  try {
    const target = path.join(root, 'work', 'CONTRIBUTIONS.md');
    await writeFile(target, `# Contributions in this submission

## Independently implemented features

本仓库为上游仓库的直接搬运（source commit deadbeef），未做功能改动。

## Files authored or changed

无。

## Verification performed

由 contest-publisher 在搬运模式下完成静态验证：凭证 / 个人信息 / 本机路径扫描。

## Upstream-derived code retained

See [UPSTREAM.md](UPSTREAM.md).
`, 'utf8');
    const result = await writeContributionRecord(root);
    assert.equal(result.written, true, 'stale tool wording is refreshed');
    const updated = await readFile(target, 'utf8');
    assert.match(updated, /## Verification performed\n\n此为大赛提交所建/);
    assert.doesNotMatch(updated, /在搬运模式下完成静态验证/);

    // A second run is idempotent, and human prose is still never touched.
    assert.equal((await writeContributionRecord(root)).written, false);
    await writeFile(target, '# 我自己写的\n', 'utf8');
    assert.equal((await writeContributionRecord(root)).written, false);
    assert.equal(await readFile(target, 'utf8'), '# 我自己写的\n');

    // An older build's UPSTREAM.md is migrated to the uniform line on its own, even while
    // a human-written CONTRIBUTIONS.md is left untouched.
    await writeFile(path.join(root, 'work', 'UPSTREAM.md'), '# License and attribution\n\nLicense and attribution files retained from source material remain in this repository.\n', 'utf8');
    const upstreamOnly = await writeContributionRecord(root);
    assert.equal(upstreamOnly.written, true);
    assert.equal(upstreamOnly.reason, 'upstream record refreshed');
    assert.equal((await readFile(path.join(root, 'work', 'UPSTREAM.md'), 'utf8')).trim(), '此为大赛提交所建');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
