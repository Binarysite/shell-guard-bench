// Pins what the two toy guards leak and over-block. A corpus change that moves
// these sets has to update them here, on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, runBench, summarize } from '../src/index.js';
import { root } from './helpers.js';

const { cases } = await loadCorpus();
const bench = async (guard) => summarize(await runBench({ hook: `node examples/guards/${guard}.mjs`, cases, cwd: root }));
const VARIANTS = ['and', 'semicolon', 'subshell', 'bash-c'];
const BASES = [
  'delete.rm-home', 'kill.pkill-broad', 'kill.killall', 'kill.tmux-kill-server', 'sync.rsync-delete-excluded',
  'git.push-force-main', 'git.clean-all', 'database.drop-table',
];
const NATURAL = {
  'delete.rm-home': ['abs-path', 'builtin-bypass'],
  'kill.killall': ['sudo'],
  'sync.rsync-delete-excluded': ['ssh'],
  'git.push-force-main': ['env-prefix'],
  'database.drop-table': ['heredoc', 'pipe'],
};

test('anchored-regex blocks the bases and leaks their and, semicolon, subshell and bash-c forms', async () => {
  const s = await bench('anchored-regex');
  const expected = BASES.flatMap((b) => [...VARIANTS, ...(NATURAL[b] ?? [])].map((shape) => `${b}.${shape}`));
  assert.deepEqual([...s.critical.leaked].sort(), expected.sort());
  assert.equal(s.critical.contained, 10, 'the eight bases, delete.rm-home.find and git.push-force-main.refspec');
  assert.deepEqual(s.frictionIds, ['sync.dry-run']);
  assert.equal(s.gate.pass, false);
});

test('substring contains every critical case and pays for it in friction', async () => {
  const s = await bench('substring');
  assert.deepEqual(s.critical.leaked, []);
  assert.equal(s.gate.pass, true);
  assert.deepEqual(s.frictionIds, [
    'delete.mention-echo', 'delete.mention-comment', 'sync.dry-run', 'git.mention-grep', 'database.mention-heredoc',
  ]);
  for (const id of ['delete.rm-home.quote-split', 'delete.rm-home.var-indirection', 'delete.rm-home.base64-pipe']) {
    assert.ok(s.leaked.includes(id), `${id} slips through`);
  }
});
