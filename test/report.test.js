import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { summarize } from '../src/index.js';
import { buildReport, formatMarkdown, formatText, TOOL } from '../src/report.js';
import { cli, root, tempDir } from './helpers.js';

const result = (id, expect, outcome, extra = {}) => ({
  id, category: id.split('.')[0], expect, severity: expect === 'block' ? 'critical' : null, origin: 'policy',
  command: `cmd ${id}`, note: null, outcome, contained: outcome === 'blocked', friction: outcome === 'blocked',
  failure: null, reason: null, legacy: false, exitCode: 0, signal: null, timedOut: false, unreapable: false,
  durationMs: 12, stderrFirstLine: null, ...extra,
});
const RUN = {
  hook: 'node guard.mjs', cwd: '/srv/stage/project', timeoutSec: 10, permissionMode: 'default', onFailure: 'continue',
  acceptRewrites: false, startedAt: '2026-10-09T00:00:00.000Z', cases: [], invalid: null,
  results: [
    result('git.push-force-main', 'block', 'blocked', { reason: 'force push' }),
    result('git.clean-all', 'block', 'failed', { failure: 'timeout', reason: 'timed out', exitCode: null }),
    result('git.mention-grep', 'allow', 'blocked', { reason: 'force push' }),
    result('git.push-bare', 'none', 'passthrough', { note: 'Depends on the upstream.' }),
  ],
};

test('the Markdown summary is stable', () => {
  assert.equal(formatMarkdown(RUN, summarize(RUN)), `### shell-guard-bench: FAIL

Hook \`node guard.mjs\`, 4 cases, contract checked 2026-10-09.

| category | dangerous | contained | leaked | controls | friction | not scored |
| --- | --- | --- | --- | --- | --- | --- |
| git | 2 | 1 | 1 | 1 | 1 | 1 |
| total | 2 | 1 (50.0%) | 1 | 1 | 1 (100.0%) | 1 |

Critical leaked: \`git.clean-all\`

Friction: \`git.mention-grep\`

Fail-open: 1 case(s) failed (timeout); with "onFailure": "block" they would be blocked.

- critical case(s) leaked: git.clean-all
`);
});

test('the text report has no timings, no absolute paths and no color', () => {
  const text = formatText(RUN, summarize(RUN), { out: 'reports/x.json' });
  assert.doesNotMatch(text, /\d+ ?ms\b|\/srv\/stage\/project|\x1b\[/);
  assert.match(text, /^shell-guard-bench \d+\.\d+\.\d+ {2}hook: node guard\.mjs {2}cases: 4 {2}contract: Claude Code hooks \(checked 2026-10-09\)\n/);
  assert.match(text, /LEAKED {6}\[critical\] git\.clean-all {2}cmd git\.clean-all {2}\(failed\)/);
  assert.match(text, /FRICTION {4}git\.mention-grep {2}cmd git\.mention-grep {2}\(blocked: force push\)/);
  assert.match(text, /NOT SCORED {2}git\.push-bare {2}passthrough {2}Depends on the upstream\./);
  assert.match(text, /Fail-open: 1 case\(s\) failed \(timeout\)/);
  assert.match(text, /RESULT: FAIL\n {2}- critical case\(s\) leaked: git\.clean-all$/);
});

test('the JSON report keeps provenance, never the environment or the cwd', () => {
  const report = buildReport(RUN, summarize(RUN));
  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(report.tool, TOOL);
  assert.match(report.provenance.corpusHash, /^[0-9a-f]{64}$/);
  assert.equal(report.provenance.hook, 'node guard.mjs');
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /\/srv\/stage\/project|"env"|"cwd"|"command"|"stdout"/);
  assert.deepEqual(Object.keys(report.results[0]).sort(), [
    'category', 'contained', 'durationMs', 'exitCode', 'expect', 'failure', 'friction', 'id', 'origin', 'outcome',
    'reason', 'rewrittenCommand', 'severity', 'signal', 'stderrFirstLine', 'timedOut',
  ]);
});

test('the CLI appends to --md instead of overwriting it', async (t) => {
  const dir = await tempDir(t);
  const md = join(dir, 'summary.md');
  const out = join(dir, 'r.json');
  const args = ['--hook', 'exit 2', '--only', 'privilege', '--out', out, '--md', md];
  await cli(...args);
  await cli(...args);
  const text = await readFile(md, 'utf8');
  assert.equal(text.match(/### shell-guard-bench: PASS/g).length, 2);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
