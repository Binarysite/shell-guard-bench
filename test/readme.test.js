// The README shows real output: the block between the example markers must be
// exactly what `node scripts/example.mjs` prints today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { loadCorpus } from '../src/index.js';
import { root, tempDir } from './helpers.js';

test('the README example block matches the real output of npm run example', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const block = /<!-- example:start -->\n```text\n([\s\S]*?)```\n<!-- example:end -->/.exec(readme);
  assert.ok(block, 'README has the example markers around a text block');
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/example.mjs'], { cwd: root });
  assert.equal(block[1], stdout);
});

test('the cases file in "Add your own cases" loads against the real corpus', async (t) => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('## Add your own cases'));
  const json = /```json\n([\s\S]*?)```/.exec(section);
  assert.ok(json, 'the section has a JSON block');
  const file = join(await tempDir(t), 'cases.json');
  await writeFile(file, json[1]);
  const { overridden } = await loadCorpus({ extra: [file] });
  assert.ok(overridden.length > 0, 'the example replaces a bundled case');
});

test('every corpus count written in the docs is the real one', async () => {
  const { CATEGORIES } = await import('../src/corpus.js');
  const { cases } = await loadCorpus();
  const read = (file) => readFile(join(root, file), 'utf8');
  const [readme, changelog, design] = await Promise.all(['README.md', 'CHANGELOG.md', 'docs/DESIGN.md'].map(read));
  const n = cases.length;
  assert.match(readme, new RegExp(`This bench throws ${n} dangerous`));
  assert.match(readme, new RegExp(`\\n${n} cases in \`corpus/\``));
  assert.match(changelog, new RegExp(`- ${n} cases in eight categories`));
  assert.match(design, new RegExp(`With ${n} cases`));

  const ORIGIN_LABELS = { incident: 'incident', policy: 'policy', variant: 'variants', common: 'common' };
  const row = (name, list) => {
    const count = (f) => list.filter(f).length;
    const origins = Object.keys(ORIGIN_LABELS).filter((o) => list.some((c) => c.origin === o));
    return [name, list.length, count((c) => c.severity === 'critical'), count((c) => c.severity === 'high'),
      count((c) => c.severity === 'normal'), count((c) => c.expect === 'allow'), count((c) => c.expect === 'none'),
      name === 'total' ? '' : origins.map((o) => ORIGIN_LABELS[o]).join(', ')].join(' | ');
  };
  const expected = [...CATEGORIES.map((cat) => row(cat, cases.filter((c) => c.category === cat))), row('total', cases)];
  const table = readme.slice(readme.indexOf('| category | cases |')).split('\n').slice(2, 3 + CATEGORIES.length)
    .map((l) => l.replace(/^\| | \|$/g, '').trim());
  assert.deepEqual(table, expected.map((l) => l.trim()));
});
