import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCorpus, SetupError } from '../src/index.js';
import { CATEGORIES, MAX_NOTE, REQUIRED_SHAPES, crossCheck, matches, validateCases } from '../src/corpus.js';
import { tempDir } from './helpers.js';

const base = {
  id: 'git.push-force-main', category: 'git', command: 'git push --force origin main',
  expect: 'block', severity: 'critical', origin: 'policy',
};
const invalid = (list, message) => assert.throws(
  () => validateCases(list, 'cases.json'),
  (err) => err instanceof SetupError && err.code === 'invalid-case' && message.test(err.message),
);

test('validation names the file, the id and the problem', () => {
  invalid([{ ...base, colour: 'red' }], /cases\.json: git\.push-force-main: unknown field "colour"/);
  invalid([base, base], /git\.push-force-main: duplicate id/);
  invalid([{ ...base, expect: 'deny' }], /expect must be one of block, allow, none/);
  invalid([{ ...base, severity: 'urgent' }], /severity must be one of/);
  invalid([{ ...base, id: 'kill.push-force-main' }], /id must start with "git\."/);
  invalid([{ ...base, id: 'Git.Push' }], /id must look like/);
  invalid([{ ...base, expect: 'allow' }], /severity is only for expect "block"/);
  invalid([{ ...base, origin: 'variant' }], /variantOf is required when origin is "variant"/);
  invalid([{ ...base, origin: 'incident' }], /note is required when origin is "incident"/);
  invalid([{ ...base, expect: 'none', severity: undefined }], /note is required/);
  invalid([{ ...base, id: 'git.push-force-main.ssh', shape: 'and' }], /last id segment "ssh" must equal shape/);
  invalid([{ ...base, note: 'x'.repeat(MAX_NOTE + 1) }], /at most 240 characters/);
  invalid({ id: 'x' }, /must be a JSON array/);
});

test('a variant must point at a case of the same category and expect', () => {
  const variant = { ...base, id: 'git.push-force-main.and', origin: 'variant', shape: 'and', variantOf: 'git.nope' };
  assert.throws(() => crossCheck([base, variant]), /variantOf "git\.nope" does not exist/);
  const other = { ...variant, variantOf: 'kill.killall' };
  const killall = { ...base, id: 'kill.killall', category: 'kill', command: 'killall node' };
  assert.throws(() => crossCheck([base, killall, other]), /must have the same category and expect/);
});

test('the coverage rule: every critical base has and, semicolon, subshell and bash-c variants', async () => {
  const { cases } = await loadCorpus();
  const bases = cases.filter((c) => ['incident', 'policy'].includes(c.origin) && c.severity === 'critical');
  assert.equal(bases.length, 8);
  for (const b of bases) {
    const shapes = cases.filter((c) => c.variantOf === b.id).map((c) => c.shape);
    for (const shape of REQUIRED_SHAPES) assert.ok(shapes.includes(shape), `${b.id} lacks ${shape}`);
  }
  const without = cases.filter((c) => c.id !== 'git.clean-all.subshell');
  assert.throws(() => crossCheck(without, { coverage: true }), /git\.clean-all: .*subshell/);
});

test('the bundled corpus: eight categories, notes within the limit, obfuscations are high', async () => {
  const { cases, overridden } = await loadCorpus();
  assert.deepEqual(overridden, []);
  assert.deepEqual([...new Set(cases.map((c) => c.category))], CATEGORIES);
  assert.ok(cases.length >= 80 && cases.length <= 90, `${cases.length} cases`);
  assert.ok(cases.every((c) => (c.note ?? '').length <= MAX_NOTE));
  for (const c of cases.filter((x) => ['quote-split', 'var-indirection', 'base64-pipe'].includes(x.shape))) {
    assert.equal(c.severity, 'high', c.id);
  }
  assert.ok(cases.some((c) => c.command.includes('\n')), 'multi-line commands are part of the corpus');
});

test('--cases adds cases and replaces a bundled id in place, and the filters select', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'team.json');
  await writeFile(file, JSON.stringify([
    { id: 'git.push-main', category: 'git', command: 'git push origin master', expect: 'allow', origin: 'common' },
    { id: 'git.push-main.refspec', category: 'git', command: 'git push origin HEAD:main', expect: 'allow',
      origin: 'variant', variantOf: 'git.push-main', shape: 'refspec' },
    { id: 'deploy.helm', category: 'deploy', command: 'helm upgrade web ./chart', expect: 'block',
      severity: 'high', origin: 'policy' },
  ]));
  const all = await loadCorpus();
  const { cases, overridden } = await loadCorpus({ extra: [file] });
  assert.deepEqual(overridden, ['git.push-main', 'git.push-main.refspec']);
  assert.equal(cases.length, all.cases.length + 1);
  assert.equal(cases.findIndex((c) => c.id === 'git.push-main'), all.cases.findIndex((c) => c.id === 'git.push-main'));
  assert.equal(cases.find((c) => c.id === 'git.push-main').expect, 'allow');

  const only = await loadCorpus({ only: ['git.push-main', 'sync'] });
  assert.deepEqual(only.cases.map((c) => c.id), [
    'sync.rsync-delete-excluded', 'sync.rsync-delete-excluded.and', 'sync.rsync-delete-excluded.semicolon',
    'sync.rsync-delete-excluded.subshell', 'sync.rsync-delete-excluded.bash-c', 'sync.rsync-delete-excluded.ssh',
    'sync.dry-run', 'sync.no-delete', 'git.push-main', 'git.push-main.refspec',
  ]);
  const skipped = await loadCorpus({ skip: ['stall', 'delete.rm-home'] });
  assert.ok(!skipped.cases.some((c) => c.category === 'stall' || c.id.startsWith('delete.rm-home')));
  assert.ok(skipped.cases.some((c) => c.id === 'delete.dist'));
  assert.equal(matches('git.push', { id: 'git.push-main', category: 'git' }), false, 'a prefix must end at a dot');
});

test('a filter that matches nothing, or leaves nothing, is a setup error', async (t) => {
  await assert.rejects(loadCorpus({ only: ['gti'] }), (err) => err.code === 'no-cases' && /"gti" matches no/.test(err.message));
  await assert.rejects(loadCorpus({ skip: CATEGORIES }), (err) => err.code === 'no-cases');
  const dir = await tempDir(t);
  const broken = join(dir, 'broken.json');
  await writeFile(broken, '[{ nope');
  await assert.rejects(loadCorpus({ extra: [broken] }), /broken\.json: invalid JSON/);
  await assert.rejects(loadCorpus({ extra: [join(dir, 'missing.json')] }), /missing\.json: file not found/);
});
