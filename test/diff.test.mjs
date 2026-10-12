import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { auditRun } from '../src/audit.mjs';
import { prepareRun } from '../src/prepare.mjs';
import { reviewFinding } from '../src/review.mjs';
import { diffRun, formatDiffReport } from '../src/diff.mjs';
import { runGit } from '../src/process.mjs';

// source has a code file carrying an email (so prepare rewrites it), a retained LICENSE
// and a docs page that policy excludes from the work copy.
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contest-diff-'));
  const source = path.join(root, 'source');
  await mkdir(path.join(source, 'src'), { recursive: true });
  await mkdir(path.join(source, 'docs'), { recursive: true });
  await writeFile(path.join(source, 'src', 'main.js'), [
    'export function answer() {',
    '  return 42;',
    '}',
    '// contact: alice@acme-corp.io',
    '',
  ].join('\n'));
  await writeFile(path.join(source, 'LICENSE'), 'MIT License\n\nCopyright (c) 2024 Alice\n');
  await writeFile(path.join(source, 'docs', 'guide.md'), '# upstream docs\n');
  runGit(['init', '-q', source]);
  runGit(['-C', source, 'add', '-A']);
  runGit(['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const audit = await auditRun(root);
  for (const finding of audit.findings) {
    const decision = finding.disposition === 'retain-attribution' ? 'retain-attribution'
      : finding.category === 'license' ? 'license-reviewed'
      : ['personal-data', 'environment-path'].includes(finding.category) ? 'sanitize'
      : 'false-positive';
    await reviewFinding(root, { findingId: finding.id, decision, note: 'diff fixture' });
  }
  await prepareRun(root, { name: 'Sample', rightsReviewed: true, contestRulesReviewed: true });
  return root;
}

test('reports added, modified, deleted and generated files with tool-vs-author attribution', async () => {
  const root = await fixture();
  try {
    const work = path.join(root, 'work');
    // author edits the copied code file, adds a new one, and removes the retained license
    const main = path.join(work, 'src', 'main.js');
    await writeFile(main, `${await (await import('node:fs/promises')).readFile(main, 'utf8')}export const added = true;\n`);
    await writeFile(path.join(work, 'src', 'new.js'), 'export const fresh = 1;\n');
    await unlink(path.join(work, 'LICENSE'));

    const report = await diffRun(root);
    const byPath = new Map(report.files.map(file => [file.path, file]));

    const mainFile = byPath.get('src/main.js');
    assert.equal(mainFile.status, 'modified');
    assert.equal(mainFile.origin, 'upstream');
    assert.equal(mainFile.rewrittenByTool, true, 'prepare replaced the email');
    assert.equal(mainFile.editedByAuthor, true, 'the author appended a line');
    assert.equal(mainFile.addedLines, 2, 'the rewritten contact line plus the appended line');
    assert.equal(mainFile.removedLines, 1, 'the rewritten contact line differs from upstream');
    assert.deepEqual(mainFile.replacements, [{ kind: 'email', from: '[REDACTED_EMAIL]' }]);
    const text = mainFile.diff.hunks.flatMap(hunk => hunk.lines.map(line => `${line.type}:${line.text}`)).join('\n');
    assert.match(text, /add:export const added = true;/);
    assert.match(text, /add:.*maintainer@example\.invalid/);

    const added = byPath.get('src/new.js');
    assert.equal(added.status, 'added');
    assert.equal(added.origin, 'author');
    assert.equal(added.addedLines, 1);

    assert.equal(byPath.get('LICENSE').status, 'deleted');
    assert.equal(byPath.get('LICENSE').origin, 'upstream');

    const generated = byPath.get('CONTRIBUTIONS.md');
    assert.equal(generated.origin, 'generated');
    assert.equal(generated.status, 'added');
    assert.equal(generated.editedByAuthor, false);

    assert.equal(report.summary.added, 6, 'generated files plus the authored file');
    assert.equal(report.summary.modified, 1);
    assert.equal(report.summary.deleted, 1);
    assert.equal(report.summary.generated, 5);
    assert.equal(report.summary.rewrittenByTool >= 1, true);
    assert.equal(report.summary.editedAndRewritten >= 1, true);
    // Project documentation is retained by policy, so it is not an "excluded" file any more.
    assert.equal(report.files.find(file => file.path === 'docs/guide.md').kind, 'docs');
    assert.equal(report.excluded.some(item => item.path === 'docs/guide.md'), false);

    const stat = formatDiffReport(report, { stat: true });
    assert.match(stat, /src\/main\.js/);
    assert.match(stat, /工具脱敏改写/);
    assert.doesNotMatch(stat, /@@/, 'stat mode has no hunks');
    const full = formatDiffReport(report);
    assert.match(full, /--- a\/src\/main\.js/);
    assert.match(full, /\+\+\+ b\/src\/main\.js/);
    assert.match(full, /@@ /);

    const single = await diffRun(root, { path: 'src/new.js' });
    assert.equal(single.files.length, 1);
    assert.equal(single.files[0].path, 'src/new.js');
    assert.equal(single.summary.added, 6, 'summary still covers the whole work copy');
    // context 0 must stay 0 (0 is a valid value, not "unset")
    assert.match(single.files[0].diff.hunks[0].header, /^@@ -\d+,0 \+\d+,1 @@$/);
    const withContext = await diffRun(root, { path: 'src/new.js', context: 3 });
    assert.equal(withContext.files[0].diff.hunks[0].header, single.files[0].diff.hunks[0].header, 'prefix/suffix trimming means no extra context exists here');

    const noHunks = await diffRun(root, { includeHunks: false });
    assert.equal(noHunks.files.every(file => file.diff === null), true);
    assert.equal(noHunks.files.find(file => file.path === 'src/new.js').addedLines, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a freshly prepared copy reports no author changes', async () => {
  const root = await fixture();
  try {
    const report = await diffRun(root);
    // The only difference against upstream is the tool's own sanitize rewrite — no author changes yet.
    assert.equal(report.summary.modified, 1);
    assert.equal(report.summary.added, 5, 'only the five generated files are new');
    assert.equal(report.summary.editedByAuthor, 0);
    assert.equal(report.summary.rewrittenByTool, 1, 'the email rewrite is reported as a tool change');
    const rewritten = report.files.find(file => file.rewrittenByTool);
    assert.equal(rewritten.path, 'src/main.js');
    assert.equal(rewritten.editedByAuthor, false);
    assert.match(formatDiffReport(report, { stat: true }), /工具脱敏改写/);
    await assert.rejects(diffRun(root, { path: 'nope.js' }), /No such file/);
    // Documentation is retained: the upstream docs page is in work/ and nothing is excluded.
    assert.equal(report.files.find(file => file.path === 'docs/guide.md').kind, 'docs');
    assert.equal(report.excluded.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Upstream may ship its own .gitignore, which prepare overwrites with the tool template. That
// overwrite is the tool's doing and must not be reported as an author edit.
async function gitignoreFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contest-diff-ignore-'));
  const source = path.join(root, 'source');
  await mkdir(path.join(source, 'src'), { recursive: true });
  await writeFile(path.join(source, 'src', 'main.js'), 'export const a = 1;\n');
  await writeFile(path.join(source, '.gitignore'), '.terraform\nterraform.tfstate\nplan.tfplan\n');
  runGit(['init', '-q', source]);
  runGit(['-C', source, 'add', '-A']);
  runGit(['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const audit = await auditRun(root);
  for (const finding of audit.findings) {
    const decision = finding.category === 'license' ? 'license-reviewed'
      : finding.disposition === 'retain-attribution' ? 'retain-attribution'
      : 'false-positive';
    await reviewFinding(root, { findingId: finding.id, decision, note: 'diff fixture' });
  }
  await prepareRun(root, { name: 'Sample', rightsReviewed: true, contestRulesReviewed: true });
  return root;
}

test('a generated .gitignore shadowing an upstream one is the tool\'s change, not the author\'s', async () => {
  const root = await gitignoreFixture();
  try {
    const report = await diffRun(root);
    const gitignore = report.files.find(file => file.path === '.gitignore');
    assert.equal(gitignore.status, 'modified', 'content differs from upstream');
    assert.equal(gitignore.origin, 'generated');
    assert.equal(gitignore.editedByAuthor, false, 'the tool wrote the template, the author did not');
    assert.equal(report.summary.editedByAuthor, 0);
    assert.equal(report.files.some(file => file.path === '.gitignore' && file.kind === 'build'), false, 'not tracked as an upstream copy');

    // Filling in CONTRIBUTIONS.md is an author change even though the tool created the file.
    await writeFile(path.join(root, 'work', 'CONTRIBUTIONS.md'), '# Contributions in this submission\n\n## Independently implemented features\n\nImplemented X by Y.\n');
    const after = await diffRun(root);
    const contributions = after.files.find(file => file.path === 'CONTRIBUTIONS.md');
    assert.equal(contributions.origin, 'generated');
    assert.equal(contributions.editedByAuthor, true);
    assert.equal(after.summary.editedByAuthor, 1);
    assert.match(formatDiffReport(after, { stat: true }), /CONTRIBUTIONS\.md\t\+5 -0\t\[工具生成 \/ 你的改动\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
