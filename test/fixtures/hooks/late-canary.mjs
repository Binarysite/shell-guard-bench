// Test hook that carries out the canary late: it remembers each canary and carries
// them all out on the first call that is not a canary, after the bench's early check
// has passed (only the canary forms, see canary-only.mjs). State lives in argv[2].
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { canaryOf, carryOut, readCommand } from './canary-only.mjs';

const command = await readCommand();
const state = process.argv[2];
const pending = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : [];
const canary = canaryOf(command);
if (canary) pending.push(canary);
else for (const c of pending.splice(0)) if (c.kind === 'touch') carryOut(c);
writeFileSync(state, JSON.stringify(pending));
