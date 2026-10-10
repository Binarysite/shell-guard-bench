// Runs a hook once, the way Claude Code runs a "command" hook: sh -c, the event as
// JSON on stdin, stdin closed. The command under test only ever travels inside that
// JSON; it is never part of a shell string.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CANARY_GRACE_MS, SetupError, canaryAfter, canaryBefore } from './canary.js';
import { classifyHookResult, firstLine } from './classify.js';
import { validateCases } from './corpus.js';

export const RUN_DEFAULTS = Object.freeze({ timeoutSec: 10, permissionMode: 'default', onFailure: 'continue' });
/** Bytes kept per stream; stdout cut at this limit is read as plain text. A bench choice, not from the docs. */
export const MAX_OUTPUT = 1024 * 1024;
/** After the kill, how long to wait for the streams to close before giving up on the process. */
export const REAP_GRACE_MS = 2000;

/**
 * The PreToolUse event for one Bash call. Optional fields the docs say may be
 * missing (prompt_id, scratchpad_dir, effort, agent_id, description) are left out.
 * @param {{ command: string, background?: boolean }} c
 * @param {{ sessionId: string, transcriptPath: string, cwd: string, permissionMode: string, toolUseId: string }} ctx
 */
export function hookInput(c, ctx) {
  return {
    session_id: ctx.sessionId,
    transcript_path: ctx.transcriptPath,
    cwd: ctx.cwd,
    permission_mode: ctx.permissionMode,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: c.command, ...(c.background ? { run_in_background: true } : {}) },
    tool_use_id: ctx.toolUseId,
  };
}

/**
 * The hook's environment: inherited, minus the OTEL_* exporter variables Claude Code
 * strips, plus CLAUDE_PROJECT_DIR when it is not already set.
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [base]
 */
export function hookEnv(cwd, base = process.env) {
  const env = Object.fromEntries(Object.entries(base).filter(([k]) => !k.startsWith('OTEL_')));
  env.CLAUDE_PROJECT_DIR ??= cwd;
  return env;
}

/** @param {string} path */
export const isDirectory = (path) => stat(path).then((s) => s.isDirectory(), () => false);

/** Process groups of the hooks running right now, for the signal handler of runBench. */
const running = new Set();

/** Kills the hook's whole process group; it may already be gone. */
function killGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // ESRCH: nothing left to kill.
  }
}

/**
 * Runs `hook` with `/bin/sh -c` in its own process group and feeds it `input`.
 * Never throws and never hangs: on timeout the group is killed, and if the streams
 * still do not close (a process in uninterruptible I/O, or a grandchild in another
 * session holding stdout) it gives up after REAP_GRACE_MS and says so. When the case
 * ends, anything the hook left running in its group is killed too.
 * @param {{ hook: string, input: object, cwd: string, timeoutSec?: number, env?: NodeJS.ProcessEnv }} opts
 */
export function runHook({ hook, input, cwd, timeoutSec = RUN_DEFAULTS.timeoutSec, env = hookEnv(cwd) }) {
  const started = Date.now();
  return new Promise((resolve) => {
    /** Raw bytes per stream, decoded once at the end so a cut never splits the count. */
    const chunks = { stdout: [], stderr: [] };
    const bytes = { stdout: 0, stderr: 0 };
    const raw = {
      exitCode: null, signal: null, timedOut: false, overflow: false, unreapable: false,
      spawnError: undefined, stdout: '', stderr: '', durationMs: 0,
    };
    let settled = false;
    let child;
    let timer;
    let reapTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(reapTimer);
      // Whatever the hook left running in its group (a `cmd &`) goes with it.
      if (child?.pid) {
        killGroup(child.pid);
        running.delete(child.pid);
      }
      for (const name of /** @type {const} */ (['stdout', 'stderr'])) raw[name] = Buffer.concat(chunks[name]).toString('utf8');
      raw.durationMs = Date.now() - started;
      resolve(raw);
    };

    try {
      child = spawn('/bin/sh', ['-c', hook], { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      raw.spawnError = err;
      finish();
      return;
    }
    if (child.pid) running.add(child.pid);

    const giveUp = () => {
      killGroup(child.pid);
      reapTimer = setTimeout(() => {
        raw.unreapable = true;
        child.stdout.destroy();
        child.stderr.destroy();
        finish();
      }, REAP_GRACE_MS);
    };
    timer = setTimeout(() => {
      raw.timedOut = true;
      giveUp();
    }, timeoutSec * 1000);

    for (const name of /** @type {const} */ (['stdout', 'stderr'])) {
      // Past the cap the rest is read and dropped, so the hook is not blocked on a
      // full pipe and its exit code still decides.
      child[name].on('data', (/** @type {Buffer} */ chunk) => {
        const room = MAX_OUTPUT - bytes[name];
        if (room > 0) chunks[name].push(chunk.length > room ? chunk.subarray(0, room) : chunk);
        bytes[name] += chunk.length;
        if (name === 'stdout' && bytes[name] > MAX_OUTPUT) raw.overflow = true;
      });
    }
    child.on('error', (err) => {
      raw.spawnError = err;
      finish();
    });
    child.on('close', (code, signal) => {
      raw.exitCode = code;
      raw.signal = signal;
      finish();
    });

    // A hook that never reads stdin closes the pipe early: EPIPE is expected, not an error.
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}

/**
 * Runs every case through the hook, one at a time and in corpus order, after the
 * canary. Throws SetupError when the bench cannot be trusted to go on.
 * @param {{ hook: string, cases: import('../index.js').Case[], cwd?: string, timeoutSec?: number,
 *   permissionMode?: import('../index.js').PermissionMode, onFailure?: 'continue' | 'block',
 *   acceptRewrites?: boolean, canaryGraceMs?: number,
 *   onResult?: (r: import('../index.js').CaseResult) => void }} opts
 * @returns {Promise<import('../index.js').BenchRun>}
 */
export async function runBench(opts) {
  if (process.platform === 'win32') {
    throw new SetupError('unsupported-platform', 'POSIX only in v0.1: hooks run with sh -c');
  }
  if (typeof opts.hook !== 'string' || !opts.hook.trim()) throw new TypeError('hook must be a non-empty string');
  if (!opts.cases?.length) throw new SetupError('no-cases', 'no cases to run');
  validateCases(opts.cases, 'cases');
  const cwd = resolve(opts.cwd ?? process.cwd());
  if (!(await isDirectory(cwd))) throw new TypeError(`cwd ${cwd} is not a directory`);
  const timeoutSec = opts.timeoutSec ?? RUN_DEFAULTS.timeoutSec;
  if (!(timeoutSec > 0)) throw new RangeError('timeoutSec must be greater than 0');
  const permissionMode = opts.permissionMode ?? RUN_DEFAULTS.permissionMode;
  const onFailure = opts.onFailure ?? RUN_DEFAULTS.onFailure;
  const acceptRewrites = Boolean(opts.acceptRewrites);
  const graceMs = opts.canaryGraceMs ?? CANARY_GRACE_MS;
  if (!(graceMs >= 0)) throw new RangeError('canaryGraceMs must be 0 or more');
  const startedAt = new Date().toISOString();

  const dir = await mkdtemp(join(tmpdir(), 'shell-guard-bench-'));
  // The hook runs in its own process group, so Ctrl+C on the terminal does not reach
  // it. On SIGINT or SIGTERM, kill it, remove the temporary directory, and let the
  // signal do what it would have done (unless someone else is listening for it).
  const onSignal = (signal) => {
    for (const pid of running) killGroup(pid);
    rmSync(dir, { recursive: true, force: true });
    stopListening();
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  const stopListening = () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const transcriptPath = join(dir, 'transcript.jsonl');
    await writeFile(transcriptPath, '');
    const ctx = { sessionId: randomUUID(), transcriptPath, cwd, permissionMode };
    const env = hookEnv(cwd);
    const judge = async (c, toolUseId) => {
      const input = hookInput(c, { ...ctx, toolUseId });
      const raw = await runHook({ hook: opts.hook, input, cwd, timeoutSec, env });
      return { raw, verdict: classifyHookResult(raw, { command: c.command, onFailure, acceptRewrites }) };
    };

    await canaryBefore(dir, async (c) => (await judge(c, `toolu_bench_${c.id.replace('-', '_')}`)).verdict, graceMs);

    const results = [];
    for (const [i, c] of opts.cases.entries()) {
      const { raw, verdict } = await judge(c, `toolu_bench_${i + 1}`);
      const result = {
        id: c.id,
        category: c.category,
        expect: c.expect,
        severity: c.severity ?? null,
        origin: c.origin,
        command: c.command,
        note: c.note ?? null,
        outcome: verdict.outcome,
        contained: verdict.contained,
        friction: verdict.friction,
        failure: verdict.failure ?? null,
        reason: verdict.reason ?? null,
        legacy: verdict.legacy ?? false,
        rewrittenCommand: verdict.rewrittenCommand,
        exitCode: raw.exitCode,
        signal: raw.signal,
        timedOut: raw.timedOut,
        unreapable: raw.unreapable,
        durationMs: raw.durationMs,
        stderrFirstLine: firstLine(raw.stderr) || null,
      };
      if (result.rewrittenCommand === undefined) delete result.rewrittenCommand;
      results.push(result);
      opts.onResult?.(result);
    }
    return {
      hook: opts.hook, cwd, timeoutSec, permissionMode, onFailure, acceptRewrites, startedAt,
      cases: opts.cases, results, invalid: await canaryAfter(dir, graceMs),
    };
  } finally {
    stopListening();
    await rm(dir, { recursive: true, force: true });
  }
}
