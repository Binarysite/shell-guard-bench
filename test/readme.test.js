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
  const block = /<!-- example:start -->\n```text\n([\s\S]*?)```\n<!-- example:end -->/.exec(readme);
  assert.ok(block, 'README has the example block');
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/example.mjs'], { cwd: root });
  // The README shows the first of the two runs; the second is summed up in prose, pinned by example.test.js.
  assert.equal(block[1], stdout.slice(0, stdout.indexOf('\n$ guard-bench', 1)));
  assert.match(readme, /contains all 84 critical cases and blocks 7 of\nthe 58 harmless commands/);
});

test('the cases file in CONTRIBUTING loads against the real corpus', async (t) => {
  const readme = await readFile(join(root, 'CONTRIBUTING.md'), 'utf8');
  const section = readme.slice(readme.indexOf('## A new case'));
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
  assert.match(changelog, new RegExp(`The corpus grows from 89 to ${n} cases`));
  const scored = cases.filter((c) => c.category !== 'stall');
  const dangerous = scored.filter((c) => c.expect === 'block').length;
  const controls = scored.filter((c) => c.expect === 'allow').length;
  assert.match(design, new RegExp(`With ${dangerous} scored dangerous cases and ${controls} controls`));
  assert.match(readme, new RegExp(`The ${controls} harmless controls outside \`stall\``));

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

test('the Measured guards tables are the committed cc-safety-net reports and promise maps', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const json = async (file) => JSON.parse(await readFile(join(root, file), 'utf8'));
  const levels = ['standard', 'strict'];
  const reports = await Promise.all(levels.map((l) => json(`reports/cc-safety-net-2.6.7-2026-11-11-${l}.json`)));
  const maps = await Promise.all(levels.map((l) => json(`promises/cc-safety-net-2.6.7-${l}.json`)));
  for (const r of reports) {
    assert.equal(r.provenance.hook, 'npx -y cc-safety-net@2.6.7 hook --coding-cli');
    assert.equal(r.provenance.isolate, true);
  }
  assert.ok(reports[1].provenance.recordedEnv.includes('CC_SAFETY_NET_LEVEL'));
  assert.ok(!reports[0].provenance.recordedEnv.includes('CC_SAFETY_NET_LEVEL'), 'standard is the default level');
  const section = readme.slice(readme.indexOf('## Measured guards'), readme.indexOf('## How it works'));

  for (const [i, label] of ['standard (default)', 'strict'].entries()) {
    const { summary: s } = reports[i];
    const p = s.promise;
    assert.equal(p.guard, maps[i].guard);
    assert.deepEqual([p.blocks.total, p.allows.total], [maps[i].blocks.length, maps[i].allows.length], 'every id ran');
    const row = `| ${label} | ${p.blocks.contained} of ${p.blocks.total} | ${p.allows.friction.length} of ${p.allows.total} `
      + `| ${s.contained} of ${s.dangerous} | ${s.friction} of ${s.controls} `
      + `| ${s.criticalBases.fullyContained} of ${s.criticalBases.total} |`;
    assert.ok(section.includes(row), `README lacks: ${row}`);
  }

  const [std, strict] = reports;
  const expectOf = new Map(std.results.map((r) => [r.id, r.expect]));
  const catOf = new Map(std.results.map((r) => [r.id, r.category]));
  for (const [cat, c] of Object.entries(std.summary.byCategory)) {
    const t = strict.summary.byCategory[cat];
    const promised = maps[0].blocks.filter((id) => catOf.get(id) === cat && expectOf.get(id) === 'block').length;
    const row = `| ${cat} | ${c.dangerous} | ${promised} | ${c.contained} | ${t.contained} | ${c.controls} | ${c.friction} `
      + `| ${t.friction} |`;
    assert.ok(section.includes(row), `README lacks: ${row}`);
  }
});
