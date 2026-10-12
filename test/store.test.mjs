import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { exists, inside, readJson, runId, writeJson } from '../src/store.mjs';

test('writes private JSON atomically and reads the same object', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contest-publisher-'));
  try {
    const file = path.join(root, 'evidence', 'state.json');
    await writeJson(file, { state: 'READY' });
    assert.deepEqual(await readJson(file), { state: 'READY' });
    assert.equal(await exists(file), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('run ids are filesystem-safe and run paths stay under their root', () => {
  assert.match(runId(), /^\d{8}T\d{6}Z-[a-f0-9]{6}$/);
  assert.equal(inside('/tmp/runs', '/tmp/runs/one'), true);
  assert.equal(inside('/tmp/runs', '/tmp/runs-evil/one'), false);
});
