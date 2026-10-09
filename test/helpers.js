// Shared by the test files; not a test file itself.
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const fixture = (name) => join(root, 'test', 'fixtures', 'hooks', name);
/** A hook command that runs a fixture with this same node binary. */
export const nodeHook = (name, ...args) => [process.execPath, fixture(name), ...args]
  .map((a) => `'${a}'`).join(' ');

/** A fresh directory, removed when the test ends. Resolved, so macOS /var and /private/var compare equal. */
export async function tempDir(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sgb-test-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const run = promisify(execFile);
/** Runs the CLI; rejects with err.code set to the exit code when it is not 0. */
export const cli = (...args) => run(process.execPath, ['bin/guard-bench.js', ...args], { cwd: root });

/** A harmless case for tests that do not need the corpus. */
export const harmless = (id = 'stall.noop', command = 'true') => ({
  id, category: 'stall', command, expect: 'allow', origin: 'common',
});
