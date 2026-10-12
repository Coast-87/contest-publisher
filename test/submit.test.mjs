import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubmitOutput, parseWorkName } from '../src/submit.mjs';

// extract-workname.mjs prints `#name=<name> source=<来源>`; only the name goes to the platform,
// which rejects anything over 30 characters.
test('parses the work name out of extract-workname output, dropping the source marker', () => {
  assert.equal(parseWorkName('#name=Smart QA System source=frontmatter\n'), 'Smart QA System');
  assert.equal(parseWorkName('#name=Gallery source=dirname\n'), 'Gallery');
  assert.equal(parseWorkName('#name=GitHub Trending 定时任务抓取与分析（Sche source=h1\n'), 'GitHub Trending 定时任务抓取与分析（Sche');
  assert.equal(parseWorkName('#name=My source=thing project source=h1\n'), 'My source=thing project');
});

test('returns null when no name line is present', () => {
  assert.equal(parseWorkName(''), null);
  assert.equal(parseWorkName('#status=200\n'), null);
});

// 提交成功后的 201 输出结构化下来，供面板展示判题状态与 A2 查询。
test('parses the 201 submission output into structured fields', () => {
  const output = [
    '提交 ICT 大赛作品「GitHub Trending 定时任务抓取与分析（Sche」（赛题 003d6510e1c22000）...',
    '#status=201',
    'submissionId=005cf853e8847000',
    'problemId=003d6510e1c22000',
    'attemptNo=1',
    'judgeStatus=pending',
    'workId=005cf853e3c00000',
    'workUrl=https://gallery.developer.huaweicloud.com/gallery/005cf853e3c00000',
  ].join('\n');
  assert.deepEqual(parseSubmitOutput(output), {
    submissionId: '005cf853e8847000',
    problemId: '003d6510e1c22000',
    attemptNo: '1',
    judgeStatus: 'pending',
    workId: '005cf853e3c00000',
    workUrl: 'https://gallery.developer.huaweicloud.com/gallery/005cf853e3c00000',
  });
  assert.deepEqual(parseSubmitOutput(''), {});
});
