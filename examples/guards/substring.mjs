#!/usr/bin/env node
// Toy guard for the demo. Not for production.
// Looks for the same patterns anywhere in the text, ignoring case, and denies with
// JSON on exit 0. It catches every critical form and also every mention of one.
import { PATTERNS, readCommand } from './patterns.mjs';

const command = await readCommand();
const hit = PATTERNS.find(([, source]) => new RegExp(source, 'i').test(command));
if (hit) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Blocked by substring: ${hit[0]}`,
    },
  }));
}
