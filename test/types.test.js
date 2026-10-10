// index.d.ts is written by hand. `npm run typecheck` proves src/index.js provides what
// it declares; this file checks the other direction: the unions in index.d.ts list
// exactly the values the code accepts, and it declares every runtime export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as api from '../src/index.js';
import { CATEGORIES, EXPECTS, ORIGINS, PLATFORMS, SEVERITIES, SHAPES } from '../src/corpus.js';
import { SETUP_ERROR_CODES } from '../src/errors.js';
import { ON_FAILURE, PERMISSION_MODES } from '../src/runner.js';
import { root } from './helpers.js';

const dts = await readFile(join(root, 'index.d.ts'), 'utf8');

/** The string literals of `export type <name> = 'a' | 'b' ...;` in index.d.ts. */
function union(name) {
  const m = new RegExp(`export type ${name} =([^;]+);`).exec(dts);
  assert.ok(m, `index.d.ts declares ${name}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('the unions in index.d.ts match the lists the code validates against', () => {
  const lists = {
    Category: CATEGORIES, Expect: EXPECTS, Severity: SEVERITIES, Origin: ORIGINS, Shape: SHAPES,
    PermissionMode: PERMISSION_MODES, OnFailure: ON_FAILURE, SetupErrorCode: SETUP_ERROR_CODES,
  };
  for (const [name, list] of Object.entries(lists)) assert.deepEqual(union(name), [...list], name);
  assert.deepEqual([.../platform\?: ([^;]+);/.exec(dts)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]), [...PLATFORMS]);
});

test('index.d.ts declares every export of src/index.js', () => {
  const declared = [...dts.matchAll(/^export (?:function|class) (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(api).sort(), declared);
});
