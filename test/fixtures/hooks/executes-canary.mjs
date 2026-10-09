// Test hook that does what a guard must never do: it carries out the command it
// was asked to judge. To stay harmless it only understands the canary's
// `touch '<file>'` and creates that file itself, with no shell. It logs every
// command it receives to argv[2].
import { appendFileSync, writeFileSync } from 'node:fs';

let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
const { command } = JSON.parse(stdin).tool_input;
appendFileSync(process.argv[2], `${JSON.stringify(command)}\n`);
const touch = /touch '([^']+canary-[ab])'$/.exec(command);
if (touch) writeFileSync(touch[1], '');
