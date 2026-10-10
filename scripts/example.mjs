// npm run example: runs the bench against the two toy guards. The anchored guard
// must fail the gate (exit 1) and the substring guard must pass it (exit 0).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEMO_LINE } from '../src/report.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const RUNS = [
  { guard: 'anchored-regex', expected: 1 },
  { guard: 'substring', expected: 0 },
];

const codes = [];
for (const { guard } of RUNS) {
  const hook = `node examples/guards/${guard}.mjs`;
  const args = ['--hook', hook, '--show', '3', '--out', `reports/${guard}.json`];
  const run = spawnSync(process.execPath, ['bin/guard-bench.js', ...args], { cwd: root, encoding: 'utf8' });
  console.log(`$ guard-bench --hook "${hook}" --show 3`);
  process.stdout.write(run.stdout + run.stderr);
  console.log(`exit code ${run.status}\n`);
  codes.push(run.status);
}
console.log(DEMO_LINE);

const ok = RUNS.every((r, i) => codes[i] === r.expected);
if (!ok) console.error(`example: expected exit codes ${RUNS.map((r) => r.expected).join(' and ')}, got ${codes.join(' and ')}`);
process.exitCode = ok ? 0 : 1;
