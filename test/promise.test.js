import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCorpus, summarize, SetupError } from '../src/index.js';
import { loadPromise, scorePromise, validatePromise } from '../src/promise.js';
import { buildReport, formatMarkdown, formatText } from '../src/report.js';
import { cli, root, tempDir } from './helpers.js';

const MAP = {
  guard: 'toy 1.0', level: 'standard', sources: ['https://example.com/rules'], checked: '2026-11-11',
  blocks: ['git.a', 'git.b'], allows: ['git.c'],
};
const r = (id, expect, contained, friction = contained) => ({
  id, category: 'git', expect, severity: expect === 'block' ? 'high' : null, origin: 'policy', variantOf: null,
  command: id, note: null, outcome: contained ? 'blocked' : 'passthrough', contained, friction, failure: null,
  reason: null, legacy: false, warning: null, exitCode: 0, signal: null, timedOut: false, unreapable: false,
  durationMs: 1, stderrFirstLine: null,
});

test('a promise map is checked against the corpus ids', () => {
  const ids = ['git.a', 'git.b', 'git.c'];
  assert.equal(validatePromise(MAP, ids, 'p.json'), MAP);
  const bad = (map, message) => assert.throws(() => validatePromise(map, ids, 'p.json'),
    (err) => err instanceof SetupError && err.code === 'invalid-promise' && message.test(err.message));
  bad([], /p\.json: must be a JSON object/);
  bad({ ...MAP, blocks: ['git.a', 'git.typo'] }, /blocks: unknown case id "git\.typo"/);
  bad({ ...MAP, allows: ['git.a'] }, /in both blocks and allows: git\.a/);
  bad({ ...MAP, blocks: ['git.a', 'git.a'] }, /blocks: duplicate id git\.a/);
  bad({ ...MAP, checked: 'yesterday' }, /checked must be a date/);
  bad({ ...MAP, sources: [] }, /sources must be a non-empty list/);
  bad({ ...MAP, extra: 1 }, /unknown field "extra"/);
  bad({ ...MAP, guard: '' }, /guard must be a non-empty string/);
  bad({ ...MAP, level: 2, note: 3, allows: 'git.c' }, /level must be a string[\s\S]*note must be a string[\s\S]*allows must be a list/);
});

test('the promise is scored apart from the bench policy', () => {
  const results = [r('git.a', 'block', true), r('git.b', 'block', false), r('git.c', 'allow', true), r('git.d', 'block', false)];
  assert.deepEqual(scorePromise({ ...MAP, blocks: [...MAP.blocks, 'git.skipped'] }, results), {
    guard: 'toy 1.0', level: 'standard', sources: ['https://example.com/rules'], checked: '2026-11-11',
    blocks: { total: 2, contained: 1, leaked: ['git.b'] },
    allows: { total: 1, friction: ['git.c'] },
    notRun: ['git.skipped'],
  });
  const s = summarize({ results, invalid: null }, { promise: MAP });
  assert.deepEqual(s.promise.outside, { leaked: ['git.d'] }, 'leaks the guard never promised to stop');
  assert.equal(s.gate.pass, true, 'the promise does not change the gate');
  assert.equal(summarize({ results, invalid: null }).promise, null);
  const run = { hook: 'toy', results, cases: [], permissionMode: 'default', onFailure: 'continue', acceptRewrites: false,
    isolate: true, recordedEnv: [], startedAt: '2026-11-11T00:00:00.000Z', invalid: null };
  assert.match(formatText(run, s), /\nPromise of toy 1\.0 \(standard\): 1 of 2 promised blocks contained, 1 of 1 promised allows blocked\n {2}leaked inside the promise: git\.b\n {2}blocked inside the promise: git\.c\nOutside the promise, by this bench's policy: 1 leaked\n/);
  assert.match(formatMarkdown(run, s), /\nPromise of toy 1\.0 \(standard\): 1 of 2 promised blocks contained, 1 of 1 promised allows blocked\. Leaked inside the promise: `git\.b`\. Blocked inside the promise: `git\.c`\. Outside the promise, by this bench's policy: 1 leaked\.\n/);
  assert.deepEqual(buildReport(run, s).summary.promise.blocks.leaked, ['git.b']);
});

test('the committed promise maps load against the bundled corpus', async () => {
  const { cases } = await loadCorpus();
  const ids = cases.map((c) => c.id);
  const files = (await readdir(join(root, 'promises'))).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 2, files.join(', '));
  for (const f of files) {
    const map = await loadPromise(join(root, 'promises', f), ids);
    assert.ok(map.blocks.length > 0, f);
  }
});

test('--promise on the CLI: scored in the report, a bad file is a setup error', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'p.json');
  const out = join(dir, 'r.json');
  await writeFile(file, JSON.stringify({ ...MAP, blocks: ['privilege.chmod-777'], allows: ['privilege.chmod-file'] }));
  const { stdout } = await cli('--hook', 'exit 2', '--only', 'privilege', '--promise', file, '--out', out);
  assert.match(stdout, /Promise of toy 1\.0 \(standard\): 1 of 1 promised blocks contained, 1 of 1 promised allows blocked/);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.summary.promise.guard, 'toy 1.0');
  await writeFile(file, JSON.stringify({ ...MAP, blocks: ['privilege.nope'] }));
  await assert.rejects(cli('--hook', 'exit 2', '--only', 'privilege', '--promise', file, '--out', out),
    (err) => err.code === 2 && /blocks: unknown case id "privilege\.nope"/.test(err.stderr));
  await assert.rejects(loadPromise(join(dir, 'missing.json'), []), /missing\.json: file not found/);
  const { cases } = await loadCorpus();
  const bundled = await loadPromise('cc-safety-net-2.6.7-standard', cases.map((c) => c.id));
  assert.equal(bundled.guard, 'cc-safety-net 2.6.7', 'a bare name is a bundled map');
  await assert.rejects(loadPromise('no-such-map', []), /promises\/no-such-map\.json: file not found/);
  await writeFile(file, '{ nope');
  await assert.rejects(loadPromise(file, []), /invalid JSON/);
});
