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

test('the README example blocks match the real output of npm run example', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const blocks = [...readme.matchAll(/<!-- example(?:-2)?:start -->\n```text\n([\s\S]*?)```\n<!-- example(?:-2)?:end -->/g)]
    .map((m) => m[1]);
  assert.equal(blocks.length, 2, 'README has the example and example-2 blocks');
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/example.mjs'], { cwd: root });
  assert.equal(blocks.join('\n'), stdout);
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
  assert.match(readme, new RegExp(`corpus-${n}%20cases`));
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

test('the Measured guards table is the committed cc-safety-net report', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const report = JSON.parse(await readFile(join(root, 'reports/cc-safety-net-2.6.7-2026-10-10.json'), 'utf8'));
  assert.equal(report.provenance.hook, 'npx -y cc-safety-net@2.6.7 hook --coding-cli');
  const section = readme.slice(readme.indexOf('## Measured guards'), readme.indexOf('## How it works'));
  for (const [cat, c] of Object.entries(report.summary.byCategory)) {
    assert.match(section, new RegExp(`\\| ${cat} \\|[^|]*\\| ${c.dangerous} \\| ${c.contained} \\| ${c.leaked} \\| ${c.controls} \\| ${c.friction} \\|`));
  }
  const s = report.summary;
  assert.match(section, new RegExp(`\\| total \\|[^|]*\\| ${s.dangerous} \\| ${s.contained} \\| ${s.dangerous - s.contained} \\| ${s.controls} \\| ${s.friction} \\|`));
});
