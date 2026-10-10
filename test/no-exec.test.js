// The tripwire: the whole corpus goes through a hook that only records what it gets,
// with PATH starting at shims of every dangerous program. If anything in the bench
// ever ran a case command (a shell string, an eval, a careless template), a shim
// would write to the log. The log must stay empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCorpus, runBench } from '../src/index.js';
import { nodeHook, tempDir } from './helpers.js';

const TRAPPED = ['rm', 'pkill', 'killall', 'tmux', 'rsync', 'git', 'psql', 'vercel', 'sudo', 'find', 'kill'];

test('no corpus command is ever executed', async (t) => {
  const dir = await tempDir(t);
  const shims = join(dir, 'shims');
  const trip = join(dir, 'tripwire.log');
  const record = join(dir, 'record.jsonl');
  await mkdir(shims);
  for (const name of TRAPPED) {
    const shim = join(shims, name);
    await writeFile(shim, `#!/bin/sh\necho "${name} $*" >> '${trip}'\nexit 0\n`);
    await chmod(shim, 0o755);
  }
  const savedPath = process.env.PATH;
  process.env.PATH = `${shims}:${savedPath}`;
  t.after(() => {
    process.env.PATH = savedPath;
  });

  const { cases } = await loadCorpus();
  const run = await runBench({ hook: nodeHook('record.mjs', record), cases, cwd: dir });

  assert.equal(existsSync(trip), false, existsSync(trip) ? await readFile(trip, 'utf8') : '');
  const received = (await readFile(record, 'utf8')).trim().split('\n').map((l) => JSON.parse(l).input.tool_input);
  assert.equal(received.length, cases.length + 2, 'two canaries, then every case');
  // Every command arrives byte for byte, newlines and quotes included, only as JSON data.
  assert.deepEqual(received.slice(2).map((i) => i.command), cases.map((c) => c.command));
  assert.equal(received.find((i) => i.run_in_background)?.command, cases.find((c) => c.background).command);
  assert.ok(run.results.every((r) => r.outcome === 'passthrough'));
});

test('the shims would have caught an execution', async (t) => {
  const dir = await tempDir(t);
  const trip = join(dir, 'tripwire.log');
  const shim = join(dir, 'rm');
  await writeFile(shim, `#!/bin/sh\necho "rm $*" >> '${trip}'\n`);
  await chmod(shim, 0o755);
  const run = await runBench({
    hook: `PATH='${dir}':$PATH; cat > /dev/null; rm -rf ./nothing-here`,
    cases: [{ id: 'stall.x', category: 'stall', command: 'true', expect: 'allow', origin: 'common' }],
    cwd: dir,
  });
  assert.equal(run.results[0].outcome, 'passthrough');
  assert.match(await readFile(trip, 'utf8'), /^rm -rf \.\/nothing-here$/m);
});

test('a hostile --cases file is data too', async (t) => {
  const dir = await tempDir(t);
  const marker = join(dir, 'marker');
  const record = join(dir, 'record.jsonl');
  const commands = [
    `echo $(touch ${marker})`, `echo \`touch ${marker}\``, `true; touch ${marker}`, `true\ntouch ${marker}`,
    `'; touch ${marker}; '`, `"; touch ${marker}; "`, `true && touch ${marker} #`,
  ];
  const file = join(dir, 'hostile.json');
  const hostile = commands.map((command, i) => ({
    id: `stall.hostile-${i}`, category: 'stall', command, expect: 'allow', origin: 'common',
  }));
  await writeFile(file, JSON.stringify(hostile));
  const { cases } = await loadCorpus({ extra: [file], only: hostile.map((c) => c.id) });
  await runBench({ hook: nodeHook('record.mjs', record), cases, cwd: dir, canaryGraceMs: 0 });
  assert.equal(existsSync(marker), false, 'a --cases command ran');
  const received = (await readFile(record, 'utf8')).trim().split('\n').map((l) => JSON.parse(l).input.tool_input.command);
  assert.deepEqual(received.slice(2), commands);
});
