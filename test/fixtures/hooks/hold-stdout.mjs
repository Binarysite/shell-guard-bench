// Test hook that exits at once but leaves a grandchild in its own session holding
// stdout open, so the stream never closes and killing the hook's group does not
// reach it. The grandchild's pid goes to argv[2] so the test can stop it.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const child = spawn('sleep', ['30'], { detached: true, stdio: ['ignore', 'inherit', 'ignore'] });
writeFileSync(process.argv[2], String(child.pid));
child.unref();
