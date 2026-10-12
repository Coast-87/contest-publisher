import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { checkJsSyntax, nodeRuntime, resetScriptRuntimeCache, resolveScriptRuntime, runNode } from '../src/process.mjs';

// Tests run under plain node, so the resolution should end on the host node
// unless CONTEST_PUBLISHER_NODE says otherwise.
test('nodeRuntime resolves the host node in a plain node process', () => {
  delete process.env.CONTEST_PUBLISHER_NODE;
  resetScriptRuntimeCache();
  assert.equal(nodeRuntime(), process.execPath);
  assert.equal(resolveScriptRuntime().env.BUN_BE_BUN, undefined);
});

test('CONTEST_PUBLISHER_NODE overrides the resolved runtime', () => {
  process.env.CONTEST_PUBLISHER_NODE = '/custom/path/to/node';
  resetScriptRuntimeCache();
  assert.equal(nodeRuntime(), '/custom/path/to/node');
  delete process.env.CONTEST_PUBLISHER_NODE;
  resetScriptRuntimeCache();
  assert.equal(nodeRuntime(), process.execPath);
});

test('runNode executes a script and captures its stdout', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'contest-proc-'));
  try {
    const script = path.join(dir, 'hello.mjs');
    await writeFile(script, 'console.log("#hello from runtime");\n');
    assert.match(runNode(script), /#hello from runtime/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('checkJsSyntax passes valid modules and rejects broken syntax without running them', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'contest-syntax-'));
  try {
    const good = path.join(dir, 'good.mjs');
    const bad = path.join(dir, 'bad.mjs');
    // A top-level side effect proves the check must not execute the file.
    await writeFile(good, 'import path from \'node:path\';\nconsole.log("SIDE-EFFECT");\nexport const sep = path.sep;\n');
    await writeFile(bad, 'const x = {;\n');
    checkJsSyntax(good);
    assert.throws(() => checkJsSyntax(bad), /--check|Syntax|exited 1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
