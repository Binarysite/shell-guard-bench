// Shared by the fixture hooks that act out a hook running what it receives. To stay
// harmless they understand only the canary forms, and only for a path inside a bench
// temporary directory: `touch '<path>'`, `true && touch '<path>'`, `rm -rf '<path>'`.
// They never start a shell.
import { rmSync, writeFileSync } from 'node:fs';

const FORM = /^(?:true && )?(touch|rm -rf) '([^']*\/shell-guard-bench-[^'/]+\/[0-9a-f]{16})'$/;

/** @returns {{ kind: 'touch' | 'rm', path: string } | null} */
export function canaryOf(command) {
  const m = FORM.exec(command);
  return m ? { kind: m[1] === 'touch' ? 'touch' : 'rm', path: m[2] } : null;
}

/** Carries out a canary the way a shell would, without a shell. */
export function carryOut({ kind, path }) {
  if (kind === 'touch') writeFileSync(path, '');
  else rmSync(path, { recursive: true, force: true });
}

export async function readCommand() {
  let stdin = '';
  for await (const chunk of process.stdin) stdin += chunk;
  return JSON.parse(stdin).tool_input.command;
}
