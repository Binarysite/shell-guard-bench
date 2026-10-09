// The README shows real output: the block between the example markers must be
// exactly what `node scripts/example.mjs` prints today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { root } from './helpers.js';

test('the README example block matches the real output of npm run example', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const block = /<!-- example:start -->\n```text\n([\s\S]*?)```\n<!-- example:end -->/.exec(readme);
  assert.ok(block, 'README has the example markers around a text block');
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/example.mjs'], { cwd: root });
  assert.equal(block[1], stdout);
});
