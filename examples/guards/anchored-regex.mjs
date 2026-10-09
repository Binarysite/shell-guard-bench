#!/usr/bin/env node
// Toy guard for the demo. Not for production.
// Matches the base patterns only at the start of the command, case sensitive, and
// blocks with exit 2 and the reason on stderr. It stops `rm -rf ~` and lets
// `cd /tmp && rm -rf ~` through.
import { PATTERNS, readCommand } from './patterns.mjs';

const command = await readCommand();
const hit = PATTERNS.find(([, source]) => new RegExp(String.raw`^\s*(?:${source})`).test(command));
if (hit) {
  process.stderr.write(`Blocked by anchored-regex: ${hit[0]}\n`);
  process.exit(2);
}
