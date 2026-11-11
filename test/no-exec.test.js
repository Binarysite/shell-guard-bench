// The tripwire: the whole corpus goes through a hook that only records what it gets,
// with PATH starting at shims of every dangerous program and HOME and TMPDIR pointing
// at a throwaway directory. If anything in the bench ever ran a case command (a shell
// string, an eval, a careless template), a shim would write to the log, and a command
// that bypasses PATH (`/bin/rm -rf ~`) would hit the fake home, not the real one.
// The log must stay empty and the sentinel in the fake home must survive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCorpus, runBench } from '../src/index.js';
import { nodeHook, tempDir } from './helpers.js';

/**
 * Programs the corpus names. `sh` is safe to shim: the runner starts hooks with
 * /bin/sh by absolute path. Shell builtins (cd, echo, kill, printf, eval) cannot be
 * shimmed; the fake HOME and the structural test cover them.
 */
const TRAPPED = [
  'rm', 'pkill', 'killall', 'tmux', 'rsync', 'git', 'psql', 'pg_dump', 'vercel', 'netlify', 'firebase', 'sudo',
  'find', 'xargs', 'kill', 'bash', 'sh', 'ssh', 'chmod', 'chown', 'tee', 'curl', 'base64', 'osascript',
  'dd', 'mkfs', 'mkfs.ext4', 'terraform', 'kubectl', 'aws', 'python', 'python3', 'docker',
];

/** Sets env variables for one test and puts them back after it. */
function setEnv(t, vars) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('no corpus command is ever executed', async (t) => {
  const dir = await tempDir(t);
  const shims = join(dir, 'shims');
  const home = join(dir, 'home');
  const tmp = join(dir, 'tmp');
  const trip = join(dir, 'tripwire.log');
  const record = join(dir, 'record.jsonl');
  await Promise.all([shims, home, tmp].map((d) => mkdir(d)));
  const sentinel = join(home, 'sentinel');
  await writeFile(sentinel, 'the fake home is still here');
  for (const name of TRAPPED) {
    const shim = join(shims, name);
    await writeFile(shim, `#!/bin/sh\necho "${name} $*" >> '${trip}'\nexit 0\n`);
    await chmod(shim, 0o755);
  }
  // A command that escapes every shim (`/bin/rm -rf ~`) would hit this home, not the developer's.
  setEnv(t, { PATH: `${shims}:${process.env.PATH}`, HOME: home, TMPDIR: tmp });

  const { cases } = await loadCorpus();
  // isolate: false is the path where the hook inherits HOME; the default isolation would hide it.
  const run = await runBench({ hook: nodeHook('record.mjs', record), cases, cwd: dir, isolate: false });

  assert.equal(existsSync(trip), false, existsSync(trip) ? await readFile(trip, 'utf8') : '');
  assert.ok(existsSync(sentinel), 'the fake home was touched');
  const lines = (await readFile(record, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.every((l) => l.home === home && l.tmpdir === tmp), 'the hook ran with the fake HOME and TMPDIR');
  const received = lines.map((l) => l.input.tool_input);
  const canaries = received.length - cases.length;
  assert.ok(canaries >= 2, 'canaries first, then every case');
  // Every command arrives byte for byte, newlines and quotes included, only as JSON data.
  assert.deepEqual(received.slice(canaries).map((i) => i.command), cases.map((c) => c.command));
  assert.equal(received.slice(canaries).find((i) => i.run_in_background)?.command, cases.find((c) => c.background).command);
  assert.ok(run.results.every((r) => r.outcome === 'passthrough'));
});

test('every process the bench starts is /bin/sh -c <hook>, and no case command is in its argv', async (t) => {
  const dir = await tempDir(t);
  const record = join(dir, 'record.jsonl');
  const hook = nodeHook('record.mjs', record);
  /** @type {unknown[][]} */
  const calls = [];
  const spawnImpl = /** @type {typeof spawn} */ ((...args) => {
    calls.push(args);
    return spawn(.../** @type {Parameters<typeof spawn>} */ (args));
  });
  const { cases } = await loadCorpus();
  await runBench({ hook, cases, cwd: dir, canaryGraceMs: 0, spawnImpl });
  assert.ok(calls.length >= cases.length + 2, `${calls.length} spawns`);
  for (const [file, argv] of calls) {
    assert.equal(file, '/bin/sh');
    assert.deepEqual(argv, ['-c', hook]);
  }
  const argvText = JSON.stringify(calls.map(([file, argv]) => [file, argv]));
  for (const c of cases) assert.ok(!argvText.includes(c.command), `${c.id} reached an argv`);
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
  assert.deepEqual(received.slice(received.length - commands.length), commands);
});
