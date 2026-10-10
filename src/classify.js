// The Claude Code PreToolUse contract as a pure function: what one hook run means
// for the Bash command it was asked to judge. Every rule here comes from the page
// in CONTRACT.source, read on CONTRACT.checked; docs/DESIGN.md has the table.
import { head } from './text.js';

/** Where the emulated contract comes from and the day it was last checked against it. */
export const CONTRACT = Object.freeze({
  source: 'https://code.claude.com/docs/en/hooks',
  checked: '2026-10-09',
});

export const DECISIONS = Object.freeze(['allow', 'deny', 'ask', 'defer']);
export const LEGACY_DECISIONS = Object.freeze({ approve: 'allow', block: 'deny' });
const STRING_FIELDS = ['reason', 'stopReason', 'systemMessage', 'terminalSequence'];
const BOOLEAN_FIELDS = ['continue', 'suppressOutput'];
const KNOWN_FIELDS = [...STRING_FIELDS, ...BOOLEAN_FIELDS, 'decision', 'hookSpecificOutput'];

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Checks the fields Claude Code knows; unknown keys are ignored, as in Claude Code.
 * @param {unknown} out
 * @returns {string | null} the first problem, or null when the output is valid
 */
export function schemaError(out) {
  if (!isObject(out)) return 'output is not a JSON object';
  const o = out;
  for (const k of STRING_FIELDS) if (k in o && typeof o[k] !== 'string') return `${k} must be a string`;
  for (const k of BOOLEAN_FIELDS) if (k in o && typeof o[k] !== 'boolean') return `${k} must be a boolean`;
  if ('decision' in o && !Object.hasOwn(LEGACY_DECISIONS, String(o.decision))) {
    return `decision must be "approve" or "block", got ${JSON.stringify(o.decision)}`;
  }
  if (!('hookSpecificOutput' in o)) return null;
  const h = o.hookSpecificOutput;
  if (!isObject(h)) return 'hookSpecificOutput must be an object';
  // The docs: hookSpecificOutput "requires a hookEventName field set to the event name".
  if (!('hookEventName' in h)) return 'hookSpecificOutput requires hookEventName "PreToolUse"';
  if (h.hookEventName !== 'PreToolUse') {
    return `hookEventName must be "PreToolUse", got ${JSON.stringify(h.hookEventName)}`;
  }
  if ('permissionDecision' in h && !DECISIONS.includes(/** @type {string} */ (h.permissionDecision))) {
    return `permissionDecision must be one of ${DECISIONS.join(', ')}, got ${JSON.stringify(h.permissionDecision)}`;
  }
  if ('permissionDecisionReason' in h && typeof h.permissionDecisionReason !== 'string') {
    return 'permissionDecisionReason must be a string';
  }
  if ('updatedInput' in h && !isObject(h.updatedInput)) return 'updatedInput must be an object';
  return null;
}

/** @param {string} text @returns {unknown} the parsed value, or undefined */
function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Claude Code parses stdout as JSON only when, trimmed, it starts with { and ends with }.
 * Two or more lines that each parse on their own are plain text, unless one of them is
 * an object that sets a known field: then the whole output is a parse failure.
 * @param {string} stdout
 */
function parseStdout(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return { kind: 'none' };
  if (!(text.startsWith('{') && text.endsWith('}'))) return { kind: 'text' };
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const lines = text.split('\n').filter((l) => l.trim()).map(tryParse);
    if (lines.length > 1 && !lines.includes(undefined)) {
      const setsField = lines.some((l) => isObject(l) && KNOWN_FIELDS.some((k) => k in l));
      if (!setsField) return { kind: 'text' };
      return { kind: 'invalid', error: 'several JSON lines, and one of them sets a field' };
    }
    return { kind: 'invalid', error: `invalid JSON: ${err.message}` };
  }
  const error = schemaError(value);
  return error ? { kind: 'invalid', error } : { kind: 'json', value };
}

/**
 * What the JSON fields decide, in Claude Code's order: continue:false, deny, ask,
 * defer, a rewrite of the command, allow, nothing.
 * @param {Record<string, any>} out
 * @param {{ command: string, acceptRewrites: boolean }} ctx
 */
function decideFields(out, { command, acceptRewrites }) {
  const h = out.hookSpecificOutput ?? {};
  const legacy = h.permissionDecision === undefined && out.decision !== undefined;
  const decision = h.permissionDecision ?? LEGACY_DECISIONS[out.decision];
  const reason = h.permissionDecisionReason ?? out.reason;
  const extra = legacy ? { legacy: true } : {};
  /**
   * @param {import('../index.js').Outcome} outcome
   * @param {boolean} contained
   * @param {boolean} friction
   * @returns {import('../index.js').Verdict}
   */
  const verdict = (outcome, contained, friction, why = reason) => ({
    outcome, contained, friction, ...(why ? { reason: why } : {}), ...extra,
  });

  // "Takes precedence over any event-specific decision fields", and the docs do
  // not promise the tool call is skipped, so it is not counted as contained.
  if (out.continue === false) return verdict('stopped', false, true, out.stopReason ?? reason);
  if (decision === 'deny') return verdict('blocked', true, true);
  if (decision === 'ask') return verdict('asked', true, true);
  if (decision === 'defer') return verdict('deferred', false, false);
  const updated = h.updatedInput;
  if (updated && updated.command !== command) {
    const rewrittenCommand = typeof updated.command === 'string' ? updated.command : null;
    return { ...verdict('rewritten', acceptRewrites, false), rewrittenCommand };
  }
  if (decision === 'allow') return verdict('allowed', false, false);
  return verdict('passthrough', false, false);
}

/**
 * Classifies one hook run under the documented PreToolUse contract.
 * `contained` says whether the command would have been stopped (it matters for a
 * dangerous case); `friction` says whether a person or the agent was stopped (it
 * matters for a harmless case).
 * @param {{ exitCode: number | null, signal: string | null, timedOut: boolean, spawnError?: Error,
 *   overflow?: boolean, stdout: string, stderr: string }} raw
 * @param {{ command: string, onFailure?: 'continue' | 'block', acceptRewrites?: boolean }} ctx
 * @returns {import('../index.js').Verdict}
 */
export function classifyHookResult(raw, ctx) {
  const blocksOnFailure = ctx.onFailure === 'block';
  const acceptRewrites = Boolean(ctx.acceptRewrites);
  /**
   * A non-blocking error lets the command run unless onFailure is "block".
   * @param {import('../index.js').Failure} failure
   * @param {string} reason
   * @returns {import('../index.js').Verdict}
   */
  const failed = (failure, reason) => ({
    outcome: 'failed', contained: blocksOnFailure, friction: blocksOnFailure, failure, reason,
  });
  const stderr = head(raw.stderr);

  if (raw.spawnError) return failed('cannot-start', raw.spawnError.message);
  if (raw.timedOut) return failed('timeout', 'timed out');
  // stdout cut at the bench's 1 MiB limit cannot be read as a whole: plain text.
  const parsed = raw.overflow ? { kind: 'text' } : parseStdout(raw.stdout);
  // Exit 2 blocks even with JSON on stdout, even a permissionDecision of "allow".
  if (raw.exitCode === 2) {
    return { outcome: 'blocked', contained: true, friction: true, ...(stderr ? { reason: stderr } : {}) };
  }

  if (raw.exitCode === 0) {
    if (parsed.kind === 'json') return decideFields(parsed.value, { command: ctx.command, acceptRewrites });
    if (parsed.kind === 'invalid') return failed('invalid-output', parsed.error);
    return { outcome: 'passthrough', contained: false, friction: false };
  }

  const how = raw.signal ? `signal ${raw.signal}` : `exit ${raw.exitCode}`;
  const failure = raw.signal ? 'signal' : 'exit-code';
  if (parsed.kind === 'json') {
    // Valid JSON makes another exit code a success, unless onFailure is "block".
    if (blocksOnFailure) return failed(failure, `${how} with valid JSON; onFailure "block" treats it as a failure`);
    return decideFields(parsed.value, { command: ctx.command, acceptRewrites });
  }
  if (parsed.kind === 'invalid') return failed('invalid-output', `${how}, ${parsed.error}`);
  const hint = raw.exitCode === 127 ? ' (command not found?)' : '';
  return failed(failure, `${how}${hint}${stderr ? `: ${stderr}` : ''}`);
}
