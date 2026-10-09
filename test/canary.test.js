import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBench, SetupError } from '../src/index.js';
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
