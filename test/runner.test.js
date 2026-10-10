import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyHookResult, runBench } from '../src/index.js';
import { hookEnv, hookInput, runHook, toCaseResult, REAP_GRACE_MS } from '../src/runner.js';
import { harmless, nodeHook, tempDir } from './helpers.js';

const readLines = async (file) => (await readFile(file, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));

/** Polls until the pid is gone (ESRCH) or the deadline passes. */
async function gone(pid, ms = 2000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

test('the hook gets the documented stdin, cwd and environment', async (t) => {
  const dir = await tempDir(t);
  const log = join(dir, 'log.jsonl');
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.invalid';
  const ctx = { sessionId: 's-1', transcriptPath: join(dir, 't.jsonl'), cwd: dir, permissionMode: 'auto', toolUseId: 'toolu_bench_1' };
  const input = hookInput({ command: 'git status', background: true }, ctx);
  const res = await runHook({ hook: nodeHook('record.mjs', log), input, cwd: dir, env: hookEnv(dir) });
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  assert.equal(res.exitCode, 0);
  const [seen] = await readLines(log);
  assert.deepEqual(seen.input, {
    session_id: 's-1',
    transcript_path: join(dir, 't.jsonl'),
    cwd: dir,
    permission_mode: 'auto',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git status', run_in_background: true },
    tool_use_id: 'toolu_bench_1',
  });
  assert.equal(seen.cwd, dir);
  assert.equal(seen.projectDir, dir);
  assert.deepEqual(seen.otel, []);
  assert.deepEqual(hookInput({ command: 'x' }, ctx).tool_input, { command: 'x' });
  assert.equal(hookEnv(dir, { CLAUDE_PROJECT_DIR: '/srv/app' }).CLAUDE_PROJECT_DIR, '/srv/app');
});

test('runBench sends one session, a fresh transcript and numbered tool_use_ids', async (t) => {
  const dir = await tempDir(t);
  const log = join(dir, 'log.jsonl');
  const run = await runBench({
    hook: nodeHook('record.mjs', log), cwd: dir, cases: [harmless('stall.a'), harmless('stall.b')],
  });
  const lines = await readLines(log);
  assert.equal(lines.length, 4, 'two canaries and two cases');
  const [first, second] = lines.slice(2).map((l) => l.input);
  assert.match(first.session_id, /^[0-9a-f-]{36}$/);
  assert.equal(second.session_id, first.session_id);
  assert.deepEqual([first.tool_use_id, second.tool_use_id], ['toolu_bench_1', 'toolu_bench_2']);
  assert.equal(first.permission_mode, 'default');
  assert.match(first.transcript_path, /transcript\.jsonl$/);
  assert.deepEqual(run.results.map((r) => r.outcome), ['passthrough', 'passthrough']);
  assert.equal(run.invalid, null);
});

test('a timeout kills the whole process group, grandchildren included', async (t) => {
  const dir = await tempDir(t);
  const pidFile = join(dir, 'pid');
  const res = await runHook({
    hook: `sleep 30 & echo $! > '${pidFile}'; wait`, input: {}, cwd: dir, timeoutSec: 0.5,
  });
  assert.equal(res.timedOut, true);
  assert.equal(res.unreapable, false);
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.ok(await gone(pid), `grandchild ${pid} still alive`);
});

test('a grandchild in another session holding stdout hits the hard deadline', async (t) => {
  const dir = await tempDir(t);
  const pidFile = join(dir, 'pid');
  const res = await runHook({ hook: nodeHook('hold-stdout.mjs', pidFile), input: {}, cwd: dir, timeoutSec: 0.3 });
  // Stop the grandchild by its own pid before anything else can fail.
  process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGKILL');
  assert.equal(res.timedOut, true);
  assert.equal(res.unreapable, true);
  assert.ok(res.durationMs < 300 + REAP_GRACE_MS + 1500, `took ${res.durationMs} ms`);
  assert.equal(classifyHookResult(res, { command: 'x' }).failure, 'timeout');
});

test('a hook that never reads stdin is fine, even with a 100 KB command', async (t) => {
  const dir = await tempDir(t);
  const input = { tool_input: { command: `echo ${'x'.repeat(100 * 1024)}` } };
  const res = await runHook({ hook: 'exit 0', input, cwd: dir });
  assert.equal(res.exitCode, 0);
  assert.equal(classifyHookResult(res, { command: 'x' }).outcome, 'passthrough');
});

test('more than 1 MiB of output is cut, and the exit code still decides', async (t) => {
  const dir = await tempDir(t);
  const flood = (stream, code) => `'${process.execPath}' -e "process.${stream}.write('x'.repeat(2 * 1024 * 1024)); `
    + `process.${stream}.on('finish', () => process.exit(${code})); process.${stream}.end()"`;
  const out0 = await runHook({ hook: flood('stdout', 0), input: {}, cwd: dir });
  assert.deepEqual([out0.overflow, out0.exitCode, out0.signal], [true, 0, null], 'the hook is not killed');
  assert.equal(Buffer.byteLength(out0.stdout), 1024 * 1024);
  assert.equal(classifyHookResult(out0, { command: 'x' }).outcome, 'passthrough');
  for (const stream of ['stdout', 'stderr']) {
    const res = await runHook({ hook: flood(stream, 2), input: {}, cwd: dir });
    assert.equal(res.exitCode, 2, stream);
    assert.equal(classifyHookResult(res, { command: 'x' }).outcome, 'blocked', stream);
  }
});

test('the 1 MiB cap is measured in bytes, not characters', async (t) => {
  const dir = await tempDir(t);
  const hook = `'${process.execPath}' -e "process.stdout.write('\u00e9'.repeat(600 * 1024))"`;
  const res = await runHook({ hook, input: {}, cwd: dir });
  assert.equal(res.overflow, true, '1.2 MB of two-byte characters is over 1 MiB');
  assert.ok(Buffer.byteLength(res.stdout) <= 1024 * 1024 + 3);
});

test('exit 127, a signal and a relative hook resolved from cwd', async (t) => {
  const dir = await tempDir(t);
  const missing = await runHook({ hook: 'no-such-guard-for-the-bench', input: {}, cwd: dir });
  assert.equal(missing.exitCode, 127);
  assert.match(classifyHookResult(missing, { command: 'x' }).reason, /command not found\?/);

  const crashed = await runHook({ hook: 'kill -SEGV $$', input: {}, cwd: dir });
  assert.equal(crashed.signal, 'SIGSEGV');
  assert.equal(classifyHookResult(crashed, { command: 'x' }).failure, 'signal');

  const guard = join(dir, 'guard.sh');
  await writeFile(guard, '#!/bin/sh\ncat > /dev/null\necho "relative guard" >&2\nexit 2\n');
  await chmod(guard, 0o755);
  const relative = await runHook({ hook: './guard.sh', input: {}, cwd: dir });
  assert.deepEqual(classifyHookResult(relative, { command: 'x' }), {
    outcome: 'blocked', contained: true, friction: true, reason: 'relative guard',
  });
});

test('a hook that cannot be spawned at all resolves as cannot-start instead of throwing', async (t) => {
  const dir = await tempDir(t);
  const res = await runHook({ hook: 'true\0x', input: {}, cwd: dir, timeoutSec: 2 });
  assert.ok(res.spawnError, 'spawnError is set');
  assert.equal(classifyHookResult(res, { command: 'x' }).failure, 'cannot-start');
});

test('runBench refuses a cwd that is not a directory', async (t) => {
  const dir = await tempDir(t);
  await assert.rejects(
    runBench({ hook: 'exit 0', cases: [harmless()], cwd: join(dir, 'missing') }),
    (err) => err instanceof TypeError && /cwd .*missing is not a directory/.test(err.message),
  );
});

test('what a hook leaves running in the background is killed when the case ends', async (t) => {
  const dir = await tempDir(t);
  const pidFile = join(dir, 'pid');
  const res = await runHook({
    hook: `sleep 30 >/dev/null 2>&1 & echo $! > '${pidFile}'`, input: {}, cwd: dir, timeoutSec: 5,
  });
  const pid = Number(await readFile(pidFile, 'utf8'));
  const dead = await gone(pid);
  if (!dead) process.kill(pid, 'SIGKILL');
  assert.equal(res.exitCode, 0);
  assert.equal(res.timedOut, false);
  assert.ok(dead, `background process ${pid} outlived its case`);
});

test('a result keeps one line of at most 200 characters of what the hook printed', () => {
  const long = `SECRET-ECHO ${'x'.repeat(300_000)}\nsecond line`;
  const raw = { exitCode: 0, signal: null, timedOut: false, unreapable: false, durationMs: 1, stdout: '', stderr: long };
  const verdict = { outcome: 'rewritten', contained: false, friction: false, reason: long, rewrittenCommand: long };
  const r = toCaseResult(harmless(), /** @type {any} */ (raw), /** @type {any} */ (verdict));
  for (const field of ['reason', 'rewrittenCommand', 'stderrFirstLine']) {
    assert.equal(r[field].length, 200, field);
    assert.ok(!r[field].includes('\n'), field);
  }
  assert.equal(toCaseResult(harmless(), /** @type {any} */ (raw), { ...verdict, rewrittenCommand: null }).rewrittenCommand, null);
});

test('runBench refuses an unknown onFailure or permissionMode instead of reading it as the default', async (t) => {
  const dir = await tempDir(t);
  const base = { hook: 'exit 0', cases: [harmless()], cwd: dir };
  await assert.rejects(runBench({ ...base, onFailure: /** @type {any} */ ('Block') }),
    (err) => err instanceof TypeError && /onFailure must be one of continue, block/.test(err.message));
  await assert.rejects(runBench({ ...base, permissionMode: /** @type {any} */ ('bogus') }),
    (err) => err instanceof TypeError && /permissionMode must be one of default, plan/.test(err.message));
});
