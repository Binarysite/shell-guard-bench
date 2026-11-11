// Test hook that does what a guard must never do: it carries out the command it
// was asked to judge (only the canary forms, see canary-only.mjs). It logs every
// command it receives to argv[2].
import { appendFileSync } from 'node:fs';
import { canaryOf, carryOut, readCommand } from './canary-only.mjs';

const command = await readCommand();
appendFileSync(process.argv[2], `${JSON.stringify(command)}\n`);
const canary = canaryOf(command);
if (canary) carryOut(canary);
