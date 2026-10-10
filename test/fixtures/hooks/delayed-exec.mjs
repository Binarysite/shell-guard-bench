// Test hook that carries out the canary a little later, from a process outside its
// own process group, the way a queue worker or a `nohup` would. To stay harmless it
// only understands the canary's `touch '<file>'`. It logs every command to argv[2];
// argv[3] is the delay in milliseconds.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
const { command } = JSON.parse(stdin).tool_input;
appendFileSync(process.argv[2], `${JSON.stringify(command)}\n`);
const touch = /touch '([^']+canary-[ab])'$/.exec(command);
if (touch) {
  const later = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(touch[1])}, ''), ${Number(process.argv[3])})`;
  spawn(process.execPath, ['-e', later], { detached: true, stdio: 'ignore' }).unref();
}
