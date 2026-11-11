import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBench, summarize, SetupError } from '../src/index.js';
import { canaryCases, prepareCanaries } from '../src/canary.js';
import { harmless, nodeHook, tempDir } from './helpers.js';

const CASES = [harmless('stall.a'), harmless('stall.b')];
const readLog = async (file) => (await readFile(file, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));

test('a hook that runs what it receives is stopped at the first canary it runs', async (t) => {
  const dir = await tempDir(t);
  const log = join(dir, 'log');
  await assert.rejects(
    runBench({ hook: nodeHook('executes-canary.mjs', log), cases: CASES, cwd: dir }),
    (err) => err instanceof SetupError && err.code === 'canary-executed'
      && /Refusing to send destructive cases/.test(err.message),
  );
  const received = await readLog(log);
  assert.ok(received.length <= 3, 'no case was sent');
  assert.ok(received.every((c) => /^(?:true && )?touch '.+'$|^rm -rf '.+'$/.test(c)), received.join(' | '));
});

test('a hook that runs only rm is caught by the rm canary', async (t) => {
  const dir = await tempDir(t);
  const log = join(dir, 'log');
  await assert.rejects(
    runBench({ hook: nodeHook('executes-rm.mjs', log), cases: CASES, cwd: dir }),
    (err) => err instanceof SetupError && err.code === 'canary-executed',
  );
  const received = await readLog(log);
  assert.ok(received.some((c) => c.startsWith('rm -rf ')), 'the rm canary was sent');
  assert.ok(!received.includes('true'), 'no case was sent');
});

test('a hook that runs the canary late makes the run invalid', async (t) => {
  const dir = await tempDir(t);
  const run = await runBench({ hook: nodeHook('late-canary.mjs', join(dir, 'state')), cases: CASES, cwd: dir });
  assert.match(run.invalid, /ran 2 canary commands after a delay/);
  const s = summarize(run);
  assert.equal(s.gate.pass, false);
  assert.match(s.gate.reasons[0], /this run is invalid/);
});

test('a hook that runs the canary a moment later is caught before any case is sent', async (t) => {
  const dir = await tempDir(t);
  const log = join(dir, 'log');
  await assert.rejects(
    runBench({ hook: nodeHook('delayed-exec.mjs', log, '300'), cases: CASES, cwd: dir }),
    (err) => err instanceof SetupError && err.code === 'canary-executed',
  );
  const received = await readLog(log);
  assert.ok(!received.includes('true'), `cases were sent: ${received.join(' | ')}`);
});

test('a hook that fails on a harmless canary would fail open on every call', async (t) => {
  const dir = await tempDir(t);
  await assert.rejects(
    runBench({ hook: 'echo "guard: config missing" >&2; exit 1', cases: CASES, cwd: dir }),
    (err) => err.code === 'hook-failed-on-canary'
      && err.message.includes('exit 1: guard: config missing')
      && err.message.includes('In Claude Code this hook would fail open on every call.'),
  );
});

test('a hook not found under the isolated HOME gets a hint about --no-isolate', async (t) => {
  const dir = await tempDir(t);
  await assert.rejects(
    runBench({ hook: '~/.claude/hooks/no-such-guard.sh', cases: CASES }),
    (err) => err.code === 'hook-failed-on-canary' && /HOME points at a temporary directory/.test(err.message),
  );
  await assert.rejects(
    runBench({ hook: '~/.claude/hooks/no-such-guard.sh', cases: CASES, cwd: dir, isolate: false }),
    (err) => err.code === 'hook-failed-on-canary' && !/HOME points at/.test(err.message),
  );
});

test('a guard that blocks the canary is fine: blocking is not running', async (t) => {
  const dir = await tempDir(t);
  const run = await runBench({ hook: 'exit 2', cases: CASES, cwd: dir });
  assert.deepEqual(run.results.map((r) => r.outcome), ['blocked', 'blocked']);
});

test('canary names are random, and the commands survive a quote in the temporary path', async (t) => {
  const dir = join(await tempDir(t), "it's here");
  await mkdir(dir);
  const first = canaryCases(dir);
  const second = canaryCases(dir);
  assert.equal(first.length, 3);
  assert.notDeepEqual(first.map((c) => c.path), second.map((c) => c.path));
  for (const c of first) assert.match(c.path, /[0-9a-f]{16}$/);
  await prepareCanaries(first);
  for (const c of first) {
    assert.equal(existsSync(c.path), c.kind === 'rm', `${c.kind} before`);
    execFileSync('/bin/sh', ['-c', c.command]);
    assert.equal(existsSync(c.path), c.kind !== 'rm', `${c.kind} after: ${c.command}`);
  }
});
