// Runs a hook once, the way Claude Code runs a "command" hook: sh -c, the event as
// JSON on stdin, stdin closed. The command under test only ever travels inside that
// JSON; it is never part of a shell string.
import { spawn } from 'node:child_process';

export const RUN_DEFAULTS = Object.freeze({ timeoutSec: 10, permissionMode: 'default', onFailure: 'continue' });
/** Output kept per stream; more than this is invalid output. */
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
 * session holding stdout) it gives up after REAP_GRACE_MS and says so.
 * @param {{ hook: string, input: object, cwd: string, timeoutSec?: number, env?: NodeJS.ProcessEnv }} opts
 */
export function runHook({ hook, input, cwd, timeoutSec = RUN_DEFAULTS.timeoutSec, env = hookEnv(cwd) }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const out = { stdout: '', stderr: '' };
    const raw = {
      exitCode: null, signal: null, timedOut: false, overflow: false, unreapable: false,
      spawnError: undefined, stdout: '', stderr: '', durationMs: 0,
    };
    let settled = false;
    let reapTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(reapTimer);
      Object.assign(raw, out, { durationMs: Date.now() - started });
      resolve(raw);
    };

    let child;
    try {
      child = spawn('/bin/sh', ['-c', hook], { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      raw.spawnError = err;
      finish();
      return;
    }

    const giveUp = () => {
      killGroup(child.pid);
      reapTimer = setTimeout(() => {
        raw.unreapable = true;
        child.stdout.destroy();
        child.stderr.destroy();
        finish();
      }, REAP_GRACE_MS);
    };
    const timer = setTimeout(() => {
      raw.timedOut = true;
      giveUp();
    }, timeoutSec * 1000);

    for (const name of /** @type {const} */ (['stdout', 'stderr'])) {
      child[name].setEncoding('utf8');
      child[name].on('data', (chunk) => {
        if (raw.overflow) return;
        out[name] += chunk;
        if (out[name].length > MAX_OUTPUT) {
          raw.overflow = true;
          out[name] = out[name].slice(0, MAX_OUTPUT);
          clearTimeout(timer);
          giveUp();
        }
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
