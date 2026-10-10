import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBench, summarize, SetupError } from '../src/index.js';
import { canaryCases } from '../src/canary.js';
import { harmless, nodeHook, tempDir } from './helpers.js';

const CASES = [harmless('stall.a'), harmless('stall.b')];

test('a hook that runs what it receives is stopped after the first canary', async (t) => {
  const dir = await tempDir(t);
  const log = join(dir, 'log');
  await assert.rejects(
    runBench({ hook: nodeHook('executes-canary.mjs', log), cases: CASES, cwd: dir }),
    (err) => err instanceof SetupError && err.code === 'canary-executed'
      && /Refusing to send destructive cases/.test(err.message),
  );
  const received = (await readFile(log, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(received.length, 1, 'only the first canary was sent');
  assert.match(received[0], /^touch '.+canary-a'$/);
});

test('a hook that runs the canary late makes the run invalid', async (t) => {
  const dir = await tempDir(t);
  const run = await runBench({ hook: nodeHook('late-canary.mjs', join(dir, 'state')), cases: CASES, cwd: dir });
  assert.match(run.invalid, /ran canary-a and canary-b after a delay/);
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
  const received = (await readFile(log, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(received.every((c) => /canary-[ab]'$/.test(c)), `cases were sent: ${received.join(' | ')}`);
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

test('a guard that blocks the canary is fine: blocking is not running', async (t) => {
  const dir = await tempDir(t);
  const run = await runBench({ hook: 'exit 2', cases: CASES, cwd: dir });
  assert.deepEqual(run.results.map((r) => r.outcome), ['blocked', 'blocked']);
});

test('the canary commands survive a quote in the temporary path', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { mkdir } = await import('node:fs/promises');
  const dir = join(await tempDir(t), "it's here");
  await mkdir(dir);
  for (const c of canaryCases(dir)) {
    execFileSync('/bin/sh', ['-c', c.command]);
    assert.ok(existsSync(c.file), c.command);
  }
});
