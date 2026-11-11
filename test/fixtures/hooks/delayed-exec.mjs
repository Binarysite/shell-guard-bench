// Test hook that carries out the canary a little later, from a process outside its
// own process group, the way a queue worker or a `nohup` would (only the canary
// forms, see canary-only.mjs). It logs every command to argv[2]; argv[3] is the
// delay in milliseconds.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { canaryOf, readCommand } from './canary-only.mjs';

const command = await readCommand();
appendFileSync(process.argv[2], `${JSON.stringify(command)}\n`);
const canary = canaryOf(command);
if (canary) {
  const fs = `require('node:fs')`;
  const act = canary.kind === 'touch'
    ? `${fs}.writeFileSync(${JSON.stringify(canary.path)}, '')`
    : `${fs}.rmSync(${JSON.stringify(canary.path)}, { recursive: true, force: true })`;
  spawn(process.execPath, ['-e', `setTimeout(() => ${act}, ${Number(process.argv[3])})`], { detached: true, stdio: 'ignore' })
    .unref();
}
