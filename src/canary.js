// Before any dangerous case goes out, the hook gets two harmless commands that create
// a file. If the file appears, the hook ran what it was asked to judge, and the bench
// stops. The bench waits a moment before it decides, for a hook that runs them in the
// background, and checks the files again at the end, for a hook that runs them late.
// It is best effort: a hook that runs only some commands (say, only `rm`) or waits
// longer is not caught.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export class SetupError extends Error {
  /**
   * @param {'unsupported-platform' | 'no-cases' | 'invalid-case' | 'canary-executed' | 'hook-failed-on-canary'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'SetupError';
    this.code = code;
  }
}

/** How long the bench waits after the canaries, and after the last case, before it looks for the files. */
export const CANARY_GRACE_MS = 1000;

export const EXECUTED_MESSAGE = 'The hook ran the command it was asked to judge. Refusing to send destructive cases.';

/** Single-quotes a path for sh, so a quote in TMPDIR cannot break the canary. */
const quote = (path) => `'${path.replaceAll("'", "'\\''")}'`;

/** @param {string} dir */
export function canaryCases(dir) {
  return [
    { id: 'canary-a', file: join(dir, 'canary-a'), command: `touch ${quote(join(dir, 'canary-a'))}` },
    { id: 'canary-b', file: join(dir, 'canary-b'), command: `true && touch ${quote(join(dir, 'canary-b'))}` },
  ];
}

/**
 * Sends each canary through `judge` and stops at the first sign of trouble.
 * @param {string} dir a fresh temporary directory
 * @param {(c: { id: string, command: string }) => Promise<import('../index.js').Verdict>} judge
 * @param {number} [graceMs]
 */
export async function canaryBefore(dir, judge, graceMs = CANARY_GRACE_MS) {
  const cases = canaryCases(dir);
  for (const c of cases) {
    const verdict = await judge(c);
    if (existsSync(c.file)) throw new SetupError('canary-executed', EXECUTED_MESSAGE);
    if (verdict.outcome === 'failed') {
      throw new SetupError(
        'hook-failed-on-canary',
        `The hook failed on a harmless canary command (${verdict.failure}: ${verdict.reason}). `
          + 'In Claude Code this hook would fail open on every call.',
      );
    }
  }
  await sleep(graceMs);
  if (cases.some((c) => existsSync(c.file))) throw new SetupError('canary-executed', EXECUTED_MESSAGE);
}

/**
 * @param {string} dir
 * @param {number} [graceMs]
 * @returns {Promise<string | null>} why the run is invalid, or null
 */
export async function canaryAfter(dir, graceMs = CANARY_GRACE_MS) {
  await sleep(graceMs);
  const ran = canaryCases(dir).filter((c) => existsSync(c.file)).map((c) => c.id);
  if (!ran.length) return null;
  return `The hook ran ${ran.join(' and ')} after a delay; this run is invalid. Every case, destructive ones `
    + 'included, was already sent to it: check what the hook could reach.';
}
