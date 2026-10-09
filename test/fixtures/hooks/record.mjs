// Test hook: appends what it received (stdin, cwd, a few env vars) to the file in
// argv[2] as one JSON line, and decides nothing. It never runs the command.
import { appendFileSync } from 'node:fs';

let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
appendFileSync(process.argv[2], `${JSON.stringify({
  input: JSON.parse(stdin),
  cwd: process.cwd(),
  projectDir: process.env.CLAUDE_PROJECT_DIR ?? null,
  otel: Object.keys(process.env).filter((k) => k.startsWith('OTEL_')),
})}\n`);
