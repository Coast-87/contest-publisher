import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { listRuns, readRunMode, statusRun, writeRunMode } from '../src/state.mjs';

test('reports a run stage from durable evidence files', async () => {
  const root = await import('node:fs/promises').then(fs => fs.mkdtemp(path.join(os.tmpdir(), 'contest-state-')));
  try {
    await mkdir(path.join(root, 'evidence'), { recursive: true });
    await writeFile(path.join(root, 'source.json'), JSON.stringify({ commit: 'abc' }));
    await writeFile(path.join(root, 'evidence', 'audit.json'), JSON.stringify({ summary: { status: 'review_required', trackedFiles: 2, counts: {} } }));
    const status = await statusRun(root);
    assert.equal(status.stage, 'AUDITED');
    assert.equal(status.audit.status, 'review_required');
    assert.equal((await listRuns(path.dirname(root))).some(item => item.runDir === root), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('marks blocked audit and verify states explicitly', async () => {
  const root = await import('node:fs/promises').then(fs => fs.mkdtemp(path.join(os.tmpdir(), 'contest-state-')));
  try {
    await mkdir(path.join(root, 'evidence'), { recursive: true });
    await writeFile(path.join(root, 'source.json'), '{}');
    await writeFile(path.join(root, 'evidence', 'audit.json'), JSON.stringify({ summary: { status: 'blocked', trackedFiles: 1, counts: { secret: 1 } } }));
    assert.equal((await statusRun(root)).stage, 'BLOCKED_AUDIT');
    await writeFile(path.join(root, 'evidence', 'verify.json'), JSON.stringify({ status: 'blocked', findings: [{ category: 'secret' }] }));
    assert.equal((await statusRun(root)).stage, 'BLOCKED_VERIFY');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('run mode defaults to strict, round-trips, and shows up in the run status', async () => {
  const root = await import('node:fs/promises').then(fs => fs.mkdtemp(path.join(os.tmpdir(), 'contest-mode-')));
  try {
    assert.equal(await readRunMode(root), 'strict');
    assert.equal(await writeRunMode(root, 'copy', 're-publish upstream as-is'), 'copy');
    assert.equal(await readRunMode(root), 'copy');
    assert.equal((await statusRun(root)).mode, 'copy');
    assert.equal(await writeRunMode(root, 'strict'), 'strict');
    assert.equal((await statusRun(root)).mode, 'strict');
    await assert.rejects(writeRunMode(root, 'sideways'), /Unknown run mode/);
    await assert.rejects(writeRunMode(path.join(root, 'missing'), 'copy'), /does not exist/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
