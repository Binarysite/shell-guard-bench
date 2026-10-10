import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHookResult } from '../src/index.js';

const CMD = 'rm -rf ~';
const raw = (exitCode, stdout = '', extra = {}) => ({
  exitCode, signal: null, timedOut: false, stdout, stderr: '', ...extra,
});
const hso = (fields) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...fields } });
const DENY = hso({ permissionDecision: 'deny', permissionDecisionReason: 'no' });
const ALLOW = hso({ permissionDecision: 'allow' });
const INVALID = '{"hookSpecificOutput": nope}';

// [name, raw result, context, expected fields]. The first nine are the cells of the
// contract table: stdout kind (valid JSON, invalid JSON, plain text) by exit code.
const ROWS = [
  ['valid JSON, exit 0: the fields decide', raw(0, DENY), {}, { outcome: 'blocked', contained: true, friction: true }],
  ['valid JSON, exit 2: blocked, even with allow', raw(2, ALLOW), {}, { outcome: 'blocked', contained: true }],
  ['valid JSON, exit 1: the fields decide', raw(1, ALLOW), {}, { outcome: 'allowed', contained: false }],
  ['invalid JSON, exit 0: failure', raw(0, INVALID), {}, { outcome: 'failed', failure: 'invalid-output', contained: false }],
  ['invalid JSON, exit 2: blocked', raw(2, INVALID), {}, { outcome: 'blocked', contained: true }],
  ['invalid JSON, exit 1: failure', raw(1, INVALID), {}, { outcome: 'failed', failure: 'invalid-output' }],
  ['plain text, exit 0: no decision', raw(0, 'looks fine'), {}, { outcome: 'passthrough', contained: false }],
  ['plain text, exit 2: blocked', raw(2, 'nope', { stderr: 'Blocked: rm\n' }), {},
    { outcome: 'blocked', contained: true, reason: 'Blocked: rm' }],
  ['plain text, exit 1: failure', raw(1, 'oops'), {}, { outcome: 'failed', failure: 'exit-code', contained: false }],

  ['ask is contained and friction', raw(0, hso({ permissionDecision: 'ask' })), {},
    { outcome: 'asked', contained: true, friction: true }],
  ['allow', raw(0, ALLOW), {}, { outcome: 'allowed', contained: false, friction: false }],
  ['defer is not contained', raw(0, hso({ permissionDecision: 'defer' })), {},
    { outcome: 'deferred', contained: false, friction: false }],
  ['legacy decision block maps to deny', raw(0, '{"decision":"block","reason":"old"}'), {},
    { outcome: 'blocked', contained: true, legacy: true, reason: 'old' }],
  ['legacy decision approve maps to allow', raw(0, '{"decision":"approve"}'), {},
    { outcome: 'allowed', legacy: true }],
  ['continue:false stops but is not contained', raw(0, '{"continue":false,"stopReason":"halt"}'), {},
    { outcome: 'stopped', contained: false, friction: true, reason: 'halt' }],
  ['continue:false wins over deny', raw(0, JSON.stringify({ continue: false, ...JSON.parse(DENY) })), {},
    { outcome: 'stopped', contained: false }],
  ['updatedInput with allow is a rewrite', raw(0, hso({ permissionDecision: 'allow', updatedInput: { command: 'ls' } })),
    {}, { outcome: 'rewritten', contained: false, friction: false, rewrittenCommand: 'ls' }],
  ['updatedInput with ask is still ask', raw(0, hso({ permissionDecision: 'ask', updatedInput: { command: 'ls' } })),
    {}, { outcome: 'asked', contained: true }],
  ['permissionDecision "block" is invalid output and lets the command run',
    raw(0, hso({ permissionDecision: 'block' })), {}, { outcome: 'failed', failure: 'invalid-output', contained: false }],
  ['JSON with surrounding whitespace is parsed', raw(0, `\n  ${DENY}  \n`), {}, { outcome: 'blocked' }],
  ['text with braces inside is plain text', raw(0, 'Blocked {x}'), {}, { outcome: 'passthrough' }],
  ['exit 127 hints at a missing command', raw(127, '', { stderr: 'sh: guard.sh: not found\n' }), {},
    { outcome: 'failed', failure: 'exit-code', reason: 'exit 127 (command not found?): sh: guard.sh: not found' }],
  ['timeout is a failure', raw(null, '', { timedOut: true, signal: 'SIGKILL' }), {},
    { outcome: 'failed', failure: 'timeout', contained: false }],
  ['a signal is a failure', raw(null, '', { signal: 'SIGSEGV' }), {}, { outcome: 'failed', failure: 'signal' }],

  ['onFailure block: a failure is contained', raw(1, 'oops'), { onFailure: 'block' },
    { outcome: 'failed', contained: true, friction: true }],
  ['onFailure block: exit 1 with deny is a failure, still contained', raw(1, DENY), { onFailure: 'block' },
    { outcome: 'failed', failure: 'exit-code', contained: true }],
  ['onFailure block: exit 1 with allow is contained', raw(1, ALLOW), { onFailure: 'block' },
    { outcome: 'failed', contained: true }],
  ['onFailure block: a timeout is contained', raw(null, '', { timedOut: true }), { onFailure: 'block' },
    { outcome: 'failed', contained: true }],
  ['onFailure block: exit 0 decisions are unchanged', raw(0, ALLOW), { onFailure: 'block' },
    { outcome: 'allowed', contained: false }],
  ['acceptRewrites: a rewrite is contained', raw(0, hso({ updatedInput: { command: 'ls' } })), { acceptRewrites: true },
    { outcome: 'rewritten', contained: true, friction: false }],

  ['updatedInput without command is a rewrite to null', raw(0, hso({ updatedInput: { description: 'x' } })), {},
    { outcome: 'rewritten', rewrittenCommand: null }],
  ['updatedInput with the same command is not a rewrite', raw(0, hso({ permissionDecision: 'allow',
    updatedInput: { command: CMD } })), {}, { outcome: 'allowed' }],
  ['{} is passthrough', raw(0, '{}'), {}, { outcome: 'passthrough' }],
  ['no output is passthrough', raw(0, ''), {}, { outcome: 'passthrough' }],
  ['a JSON array is plain text', raw(0, '[1]'), {}, { outcome: 'passthrough' }],
  ['hookSpecificOutput without hookEventName is invalid, as the docs require it',
    raw(0, JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny' } })), {},
    { outcome: 'failed', failure: 'invalid-output', reason: 'hookSpecificOutput requires hookEventName "PreToolUse"' }],
  ['wrong hookEventName is invalid', raw(0, JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse' } })),
    {}, { outcome: 'failed', failure: 'invalid-output' }],
  ['a hook that cannot start is a failure', raw(null, '', { spawnError: new Error('spawn ENOENT') }), {},
    { outcome: 'failed', failure: 'cannot-start' }],
  ['JSON lines that set no field are plain text', raw(0, '{"x":1}\n{"y":2}\n'), { onFailure: 'block' },
    { outcome: 'passthrough', contained: false }],
  ['JSON lines where one sets a field are invalid', raw(0, `{"x":1}\n${DENY}`), {},
    { outcome: 'failed', failure: 'invalid-output' }],
  ['stdout over the limit is plain text: exit 0 decides nothing', raw(0, DENY, { overflow: true }), {},
    { outcome: 'passthrough', contained: false }],
  ['stdout over the limit with exit 2 is blocked', raw(2, DENY, { overflow: true }), {}, { outcome: 'blocked' }],
  ['stdout over the limit with exit 1 is a failure', raw(1, DENY, { overflow: true }), {},
    { outcome: 'failed', failure: 'exit-code' }],
];

for (const [name, result, ctx, expected] of ROWS) {
  test(name, () => {
    const verdict = classifyHookResult(result, { command: CMD, ...ctx });
    for (const [k, v] of Object.entries(expected)) assert.deepEqual(verdict[k], v, `${k} in ${JSON.stringify(verdict)}`);
  });
}
