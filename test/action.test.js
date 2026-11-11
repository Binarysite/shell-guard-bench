// action.yml is a composite action other repositories run with `uses:`. Its script
// must read every input from the environment: a ${{ }} inside `run:` would paste a
// hook command into bash before it runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './helpers.js';

const yml = await readFile(join(root, 'action.yml'), 'utf8');

test('the action script never interpolates an expression', () => {
  const run = yml.slice(yml.indexOf('      run: |'));
  assert.ok(run.length > 100, 'the bench step has a run block');
  assert.doesNotMatch(run, /\$\{\{/);
});

test('every input reaches the script through an SGB_ variable, and every CLI flag it passes exists', async () => {
  const inputs = [...yml.slice(yml.indexOf('inputs:'), yml.indexOf('outputs:')).matchAll(/^ {2}([a-z-]+):$/gm)]
    .map((m) => m[1]).filter((name) => name !== 'node-version');
  for (const name of inputs) {
    const env = `SGB_${name.toUpperCase().replaceAll('-', '_')}: \${{ inputs.${name} }}`;
    assert.ok(yml.includes(env), `missing ${env}`);
  }
  const help = (await import('node:child_process')).execFileSync(process.execPath, ['bin/guard-bench.js', '--help'],
    { cwd: root, encoding: 'utf8' });
  for (const [, flag] of yml.matchAll(/(--[a-z-]+)/g)) assert.ok(help.includes(flag), `${flag} is not a CLI flag`);
});
