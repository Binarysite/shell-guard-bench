// Test hook that runs only rm commands, the kind a touch canary alone would miss
// (only the canary form, see canary-only.mjs). It logs every command to argv[2].
import { appendFileSync } from 'node:fs';
import { canaryOf, carryOut, readCommand } from './canary-only.mjs';

const command = await readCommand();
appendFileSync(process.argv[2], `${JSON.stringify(command)}\n`);
const canary = canaryOf(command);
if (canary?.kind === 'rm') carryOut(canary);
