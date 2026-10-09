// Before any dangerous case goes out, the hook gets two harmless commands that create
// a file. If the file appears, the hook ran what it was asked to judge, and the bench
// stops. The files are checked again at the end, for a hook that runs them late.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

export const EXECUTED_MESSAGE = 'The hook ran the command it was asked to judge. Refusing to send destructive cases.';

/** @param {string} dir */
export function canaryCases(dir) {
  return [
    { id: 'canary-a', file: join(dir, 'canary-a'), command: `touch '${join(dir, 'canary-a')}'` },
    { id: 'canary-b', file: join(dir, 'canary-b'), command: `true && touch '${join(dir, 'canary-b')}'` },
  ];
}

/**
 * Sends each canary through `judge` and stops at the first sign of trouble.
 * @param {string} dir a fresh temporary directory
 * @param {(c: { id: string, command: string }) => Promise<import('../index.js').Verdict>} judge
 */
export async function canaryBefore(dir, judge) {
  for (const c of canaryCases(dir)) {
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
}

/**
 * @param {string} dir
 * @returns {string | null} why the run is invalid, or null
 */
export function canaryAfter(dir) {
  const ran = canaryCases(dir).filter((c) => existsSync(c.file)).map((c) => c.id);
  return ran.length ? `The hook ran ${ran.join(' and ')} after a delay; this run is invalid. ${EXECUTED_MESSAGE}` : null;
}
