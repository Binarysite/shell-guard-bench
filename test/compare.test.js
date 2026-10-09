import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compareReports } from '../src/index.js';
import { cli, tempDir } from './helpers.js';

const result = (id, expect, outcome, contained, friction) => ({ id, expect, severity: null, outcome, contained, friction });
const report = (results, provenance = {}) => ({
  schemaVersion: 1,
  contract: { checked: '2026-10-09' },
  provenance: { hook: 'guard', corpusHash: 'abc', onFailure: 'continue', permissionMode: 'default', ...provenance },
  results,
});
const BEFORE = report([
  result('git.a', 'block', 'blocked', true, true),
  result('git.b', 'block', 'passthrough', false, false),
  result('git.c', 'allow', 'passthrough', false, false),
  result('git.d', 'allow', 'blocked', true, true),
  result('git.gone', 'block', 'blocked', true, true),
]);
const AFTER = report([
  result('git.a', 'block', 'passthrough', false, false),
  result('git.b', 'block', 'asked', true, true),
  result('git.c', 'allow', 'asked', true, true),
  result('git.d', 'allow', 'passthrough', false, false),
  result('git.new', 'block', 'blocked', true, true),
], { hook: 'guard v2', corpusHash: 'def' });

test('regressions both ways, improvements, and warnings', () => {
  const { regressions, improvements, warnings } = compareReports(BEFORE, AFTER);
  assert.deepEqual(regressions.map((c) => `${c.id} ${c.from}->${c.to}`), [
    'git.a blocked->passthrough', 'git.c passthrough->asked',
  ]);
  assert.deepEqual(improvements.map((c) => c.id), ['git.b', 'git.d']);
  assert.deepEqual(warnings, [
    'corpus changed: "abc" -> "def"',
    'hook changed: "guard" -> "guard v2"',
    'only in before: git.gone',
    'only in after: git.new',
  ]);
  assert.deepEqual(compareReports(BEFORE, BEFORE), { regressions: [], improvements: [], warnings: [] });
  assert.throws(() => compareReports({ schemaVersion: 2, results: [] }, BEFORE), /before: not a shell-guard-bench report/);
});

test('compare CLI exits 0 without regressions, 1 with them, 2 on bad input', async (t) => {
  const dir = await tempDir(t);
  const [before, after, broken, future] = ['before', 'after', 'broken', 'future'].map((n) => join(dir, `${n}.json`));
  await writeFile(before, JSON.stringify(BEFORE));
  await writeFile(after, JSON.stringify(AFTER));
  await writeFile(broken, '{ nope');
  await writeFile(future, JSON.stringify({ ...BEFORE, schemaVersion: 9 }));

  const same = await cli('compare', before, before);
  assert.match(same.stdout, /No case changed side\.\nRESULT: PASS/);
  await assert.rejects(cli('compare', before, after), (err) => err.code === 1
    && /Regressions:\n {2}blocked {5}-> passthrough {1}git\.a/.test(err.stdout)
    && /warning: hook changed/.test(err.stdout));
  const fixed = await cli('compare', after, before).catch((err) => err);
  assert.equal(fixed.code, 1, 'reversed, the improvements become regressions');
  await assert.rejects(cli('compare', before, broken), (err) => err.code === 2 && err.stderr.includes('invalid JSON'));
  await assert.rejects(cli('compare', before, future), (err) => err.code === 2
    && err.stderr.includes(`${future}: not a shell-guard-bench report`));
  await assert.rejects(cli('compare', before), (err) => err.code === 2 && /needs two reports/.test(err.stderr));
});
