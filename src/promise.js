// A promise map: what one guard says it blocks and lets through, as case ids. It
// scores the guard against its own stated scope, apart from the bench's policy,
// which is wider on purpose. The map is data written by whoever measures the guard,
// with the sources it was read from and the day it was read.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SetupError, fileProblem } from './errors.js';

const FIELDS = new Set(['guard', 'level', 'sources', 'checked', 'blocks', 'allows', 'note']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** @param {unknown} v @returns {v is string[]} */
const isStringList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Checks a promise map against the ids of the corpus it will score.
 * @param {unknown} map
 * @param {string[]} ids every case id the map may name
 * @param {string} source file name for error messages
 * @returns {import('../index.js').PromiseMap}
 */
export function validatePromise(map, ids, source) {
  const p = [];
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    throw new SetupError('invalid-promise', `${source}: must be a JSON object`);
  }
  const m = /** @type {Record<string, unknown>} */ (map);
  for (const k of Object.keys(m)) if (!FIELDS.has(k)) p.push(`unknown field "${k}"`);
  if (typeof m.guard !== 'string' || !m.guard.trim()) p.push('guard must be a non-empty string');
  if ('level' in m && typeof m.level !== 'string') p.push('level must be a string');
  if ('note' in m && typeof m.note !== 'string') p.push('note must be a string');
  if (!isStringList(m.sources) || !m.sources.length) p.push('sources must be a non-empty list of strings');
  if (typeof m.checked !== 'string' || !DAY.test(m.checked)) p.push('checked must be a date, YYYY-MM-DD');
  for (const k of ['blocks', 'allows']) {
    if (!isStringList(m[k])) {
      p.push(`${k} must be a list of case ids`);
      continue;
    }
    const known = new Set(ids);
    const list = /** @type {string[]} */ (m[k]);
    const unknown = list.filter((id) => !known.has(id));
    if (unknown.length) p.push(`${k}: unknown case id ${unknown.map((x) => JSON.stringify(x)).join(', ')}`);
    const dup = list.filter((id, i) => list.indexOf(id) !== i);
    if (dup.length) p.push(`${k}: duplicate id ${dup.join(', ')}`);
  }
  if (isStringList(m.blocks) && isStringList(m.allows)) {
    const allows = /** @type {string[]} */ (m.allows);
    const both = /** @type {string[]} */ (m.blocks).filter((id) => allows.includes(id));
    if (both.length) p.push(`in both blocks and allows: ${both.join(', ')}`);
  }
  if (p.length) throw new SetupError('invalid-promise', p.map((x) => `${source}: ${x}`).join('\n'));
  return /** @type {import('../index.js').PromiseMap} */ (map);
}

const BUNDLED = new URL('../promises/', import.meta.url);

/**
 * A bare name (no slash, no .json) is a map bundled in promises/; anything else is a path.
 * @param {string} nameOrPath
 */
export function promisePath(nameOrPath) {
  if (nameOrPath.includes('/') || nameOrPath.endsWith('.json')) return nameOrPath;
  return fileURLToPath(new URL(`${nameOrPath}.json`, BUNDLED));
}

/**
 * @param {string} file a path, or the name of a bundled map
 * @param {string[]} ids
 */
export async function loadPromise(file, ids) {
  file = promisePath(file);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    throw new SetupError('invalid-promise', `${file}: ${fileProblem(err)}`);
  }
  let map;
  try {
    map = JSON.parse(text);
  } catch (err) {
    throw new SetupError('invalid-promise', `${file}: invalid JSON: ${/** @type {Error} */ (err).message}`);
  }
  return validatePromise(map, ids, file);
}

/**
 * How the guard did against its own promise. Ids in the map that did not run (an
 * --only that skipped them) are listed as notRun, not scored.
 * @param {import('../index.js').PromiseMap} map
 * @param {Pick<import('../index.js').CaseResult, 'id' | 'contained' | 'friction'>[]} results
 * @returns {Omit<import('../index.js').PromiseScore, 'outside'>}
 */
export function scorePromise(map, results) {
  const byId = new Map(results.map((r) => [r.id, r]));
  /** @param {string[]} ids */
  const ran = (ids) => ids.filter((id) => byId.has(id));
  /** @param {string} id */
  const got = (id) => /** @type {Pick<import('../index.js').CaseResult, 'id' | 'contained' | 'friction'>} */ (byId.get(id));
  const blocks = ran(map.blocks);
  const allows = ran(map.allows);
  return {
    guard: map.guard,
    level: map.level ?? null,
    sources: [...map.sources],
    checked: map.checked,
    blocks: {
      total: blocks.length,
      contained: blocks.filter((id) => got(id).contained).length,
      leaked: blocks.filter((id) => !got(id).contained),
    },
    allows: {
      total: allows.length,
      friction: allows.filter((id) => got(id).friction),
    },
    notRun: [...map.blocks, ...map.allows].filter((id) => !byId.has(id)),
  };
}
