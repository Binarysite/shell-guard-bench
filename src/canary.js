// Before any dangerous case goes out, the hook gets three harmless commands on paths
// with random names in the bench's temporary directory: two create a file, one
// removes a directory the bench created. If a file appears or the directory goes,
// the hook ran what it was asked to judge, and the bench stops. They go in random
// order with the same tool_use_id format as the cases, so a hook cannot tell them
// apart by name or id. The bench waits a moment before it decides, for a hook that
// runs them in the background, and checks again at the end, for a hook that runs
// them late. It is best effort: a hook that runs only some commands (say, only
// `git`) or waits longer is not caught.
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { SetupError } from './errors.js';

/** How long the bench waits after the canaries, and after the last case, before it looks. */
export const CANARY_GRACE_MS = 1000;

const EXECUTED_MESSAGE = 'The hook ran the command it was asked to judge. Refusing to send destructive cases.';

/** Single-quotes a path for sh, so a quote in TMPDIR cannot break the canary. */
/** @param {string} path */
const quote = (path) => `'${path.replaceAll("'", "'\\''")}'`;
const name = () => randomBytes(8).toString('hex');

/**
 * @typedef {{ kind: 'touch' | 'rm', path: string, command: string }} Canary
 */

/**
 * Three canaries with fresh random paths in `dir`, in random order.
 * @param {string} dir
 * @returns {Canary[]}
 */
export function canaryCases(dir) {
  const [a, b, c] = [name(), name(), name()].map((n) => join(dir, n));
  /** @type {Canary[]} */
  const list = [
    { kind: 'touch', path: a, command: `touch ${quote(a)}` },
    { kind: 'touch', path: b, command: `true && touch ${quote(b)}` },
    { kind: 'rm', path: c, command: `rm -rf ${quote(c)}` },
  ];
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Creates what the rm canaries are meant to remove. @param {Canary[]} canaries */
export async function prepareCanaries(canaries) {
  for (const c of canaries.filter((x) => x.kind === 'rm')) {
    await mkdir(c.path);
    await writeFile(join(c.path, 'keep'), '');
  }
}

/** @param {Canary} c */
const ran = (c) => (c.kind === 'touch' ? existsSync(c.path) : !existsSync(c.path));

/**
 * Sends each canary through `judge` and stops at the first sign of trouble.
 * @param {Canary[]} canaries from canaryCases, not yet prepared
 * @param {(c: Canary) => Promise<import('../index.js').Verdict>} judge
 * @param {{ graceMs?: number, hint?: string }} [opts] `hint` is added when the hook fails
 */
export async function canaryBefore(canaries, judge, { graceMs = CANARY_GRACE_MS, hint = '' } = {}) {
  await prepareCanaries(canaries);
  for (const c of canaries) {
    const verdict = await judge(c);
    if (ran(c)) throw new SetupError('canary-executed', EXECUTED_MESSAGE);
    if (verdict.outcome === 'failed') {
      throw new SetupError(
        'hook-failed-on-canary',
        `The hook failed on a harmless canary command (${verdict.failure}: ${verdict.reason}). `
          + `In Claude Code this hook would fail open on every call.${hint}`,
      );
    }
  }
  await sleep(graceMs);
  if (canaries.some(ran)) throw new SetupError('canary-executed', EXECUTED_MESSAGE);
}

/**
 * @param {Canary[]} canaries
 * @param {number} [graceMs]
 * @returns {Promise<string | null>} why the run is invalid, or null
 */
export async function canaryAfter(canaries, graceMs = CANARY_GRACE_MS) {
  await sleep(graceMs);
  const n = canaries.filter(ran).length;
  if (!n) return null;
  return `The hook ran ${n} canary command${n > 1 ? 's' : ''} after a delay; this run is invalid. Every case, `
    + 'destructive ones included, was already sent to it: check what the hook could reach.';
}
