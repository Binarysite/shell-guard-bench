// The corpus: one JSON file per category, validated strictly so a typo in a case is
// an error with a file name and an id, not a silently different bench.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SetupError } from './errors.js';

export const CATEGORIES = Object.freeze(['delete', 'kill', 'sync', 'git', 'deploy', 'database', 'privilege', 'stall']);
export const EXPECTS = Object.freeze(['block', 'allow', 'none']);
export const SEVERITIES = Object.freeze(['critical', 'high', 'normal']);
export const ORIGINS = Object.freeze(['incident', 'policy', 'variant', 'common']);
export const PLATFORMS = Object.freeze(['any', 'macos', 'linux']);
export const SHAPES = Object.freeze([
  'plain', 'and', 'or', 'semicolon', 'newline', 'pipe', 'subshell', 'backticks', 'bash-c', 'sh-c', 'eval', 'ssh',
  'sudo', 'env-prefix', 'abs-path', 'builtin-bypass', 'xargs', 'find', 'heredoc', 'refspec', 'comment',
  'mention-echo', 'mention-grep', 'quote-split', 'var-indirection', 'base64-pipe', 'line-continuation', 'background',
]);
/** Every critical base case must also be caught in these forms. */
export const REQUIRED_SHAPES = Object.freeze(['and', 'semicolon', 'subshell', 'bash-c']);
export const MAX_NOTE = 240;

const FIELDS = new Set([
  'id', 'category', 'command', 'expect', 'severity', 'origin', 'variantOf', 'shape', 'background', 'platform', 'note',
]);
const ID = /^([a-z]+)\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\.([a-z0-9]+(?:-[a-z0-9]+)*))?$/;
const CORPUS_DIR = new URL('../corpus/', import.meta.url);

const oneOf = (list, value) => list.includes(value);

/**
 * Validates one case and returns the problems found, each naming the field.
 * @param {any} c
 * @returns {string[]}
 */
function caseProblems(c) {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return ['a case must be a JSON object'];
  const p = [];
  for (const k of Object.keys(c)) if (!FIELDS.has(k)) p.push(`unknown field "${k}"`);
  const m = typeof c.id === 'string' ? ID.exec(c.id) : null;
  if (!m) p.push('id must look like <category>.<slug>[.<shape>], lowercase');
  if (!oneOf(CATEGORIES, c.category)) p.push(`category must be one of ${CATEGORIES.join(', ')}`);
  else if (m && m[1] !== c.category) p.push(`id must start with "${c.category}."`);
  if (typeof c.command !== 'string' || !c.command.trim()) p.push('command must be a non-empty string');
  if (!oneOf(EXPECTS, c.expect)) p.push(`expect must be one of ${EXPECTS.join(', ')}`);
  if (c.expect === 'block' && !oneOf(SEVERITIES, c.severity)) {
    p.push(`severity must be one of ${SEVERITIES.join(', ')} when expect is "block"`);
  }
  if (c.expect !== 'block' && 'severity' in c) p.push('severity is only for expect "block"');
  if (!oneOf(ORIGINS, c.origin)) p.push(`origin must be one of ${ORIGINS.join(', ')}`);
  if ((c.origin === 'variant') !== (typeof c.variantOf === 'string')) {
    p.push('variantOf is required when origin is "variant", and only then');
  }
  if ('shape' in c && !oneOf(SHAPES, c.shape)) p.push(`unknown shape ${JSON.stringify(c.shape)}`);
  if (m && m[2] !== undefined && m[2] !== c.shape) p.push(`the last id segment "${m[2]}" must equal shape`);
  if ('background' in c && typeof c.background !== 'boolean') p.push('background must be a boolean');
  if ('platform' in c && !oneOf(PLATFORMS, c.platform)) p.push(`platform must be one of ${PLATFORMS.join(', ')}`);
  if ('note' in c && (typeof c.note !== 'string' || c.note.length > MAX_NOTE)) {
    p.push(`note must be a string of at most ${MAX_NOTE} characters`);
  }
  if ((c.origin === 'incident' || c.expect === 'none') && !c.note) {
    p.push('note is required when origin is "incident" or expect is "none"');
  }
  return p;
}

/**
 * Checks a list of cases from one file.
 * @param {unknown} list
 * @param {string} source file name for error messages
 * @returns {import('../index.js').Case[]}
 */
export function validateCases(list, source) {
  if (!Array.isArray(list)) throw new SetupError('invalid-case', `${source}: must be a JSON array of cases`);
  const seen = new Set();
  const errors = [];
  for (const [i, c] of list.entries()) {
    const label = typeof c?.id === 'string' ? c.id : `case #${i + 1}`;
    for (const problem of caseProblems(c)) errors.push(`${source}: ${label}: ${problem}`);
    if (seen.has(c?.id)) errors.push(`${source}: ${label}: duplicate id`);
    seen.add(c?.id);
  }
  if (errors.length) throw new SetupError('invalid-case', errors.join('\n'));
  return list;
}

/**
 * Rules across cases: a variant points at a case of the same category and expect,
 * and (for the bundled corpus) every critical base has the required variant shapes.
 * @param {import('../index.js').Case[]} cases
 * @param {{ coverage?: boolean }} [opts]
 */
export function crossCheck(cases, { coverage = false } = {}) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const errors = [];
  for (const c of cases.filter((x) => x.origin === 'variant')) {
    const base = byId.get(c.variantOf);
    if (!base) errors.push(`${c.id}: variantOf "${c.variantOf}" does not exist`);
    else if (base.category !== c.category || base.expect !== c.expect) {
      errors.push(`${c.id}: variantOf "${c.variantOf}" must have the same category and expect; replace both ids together`);
    }
  }
  if (coverage) {
    for (const base of cases.filter((c) => ['incident', 'policy'].includes(c.origin) && c.severity === 'critical')) {
      const shapes = new Set(cases.filter((c) => c.variantOf === base.id).map((c) => String(c.shape)));
      const missing = REQUIRED_SHAPES.filter((s) => !shapes.has(s));
      if (missing.length) errors.push(`${base.id}: critical base without variants of shape ${missing.join(', ')}`);
    }
  }
  if (errors.length) throw new SetupError('invalid-case', errors.join('\n'));
}

async function readCases(file, label) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    throw new SetupError('invalid-case', `${label}: ${err.code === 'ENOENT' ? 'file not found' : err.message}`);
  }
  try {
    return validateCases(JSON.parse(text), label);
  } catch (err) {
    if (err instanceof SetupError) throw err;
    throw new SetupError('invalid-case', `${label}: invalid JSON: ${err.message}`);
  }
}

/**
 * An entry selects a case when it equals the category, the id, or an id prefix
 * that ends at a dot ("git.push-main" selects "git.push-main.refspec").
 * @param {string} entry
 * @param {{ id: string, category: string }} c
 */
export function matches(entry, c) {
  return entry === c.category || entry === c.id || c.id.startsWith(`${entry}.`);
}

function applyFilter(cases, entries, flag) {
  const unknown = entries.filter((e) => !cases.some((c) => matches(e, c)));
  if (unknown.length) {
    throw new SetupError('no-cases', `${flag} "${unknown.join('", "')}" matches no category, id or id prefix`);
  }
}

/**
 * Loads the bundled corpus, merges extra case files (an existing id replaces the
 * bundled case in place) and applies the filters.
 * @param {{ extra?: string[], only?: string[], skip?: string[] }} [opts]
 */
export async function loadCorpus({ extra = [], only = [], skip = [] } = {}) {
  const bundled = [];
  for (const category of CATEGORIES) {
    bundled.push(...(await readCases(new URL(`${category}.json`, CORPUS_DIR), `corpus/${category}.json`)));
  }
  validateCases(bundled, 'corpus');
  crossCheck(bundled, { coverage: true });

  const cases = [...bundled];
  const overridden = [];
  const extraIds = new Set();
  for (const file of extra) {
    for (const c of await readCases(file, file)) {
      if (extraIds.has(c.id)) throw new SetupError('invalid-case', `${file}: ${c.id}: duplicate id across --cases files`);
      extraIds.add(c.id);
      const at = cases.findIndex((x) => x.id === c.id);
      if (at === -1) cases.push(c);
      else {
        cases[at] = c;
        overridden.push(c.id);
      }
    }
  }
  crossCheck(cases);

  applyFilter(cases, only, '--only');
  applyFilter(cases, skip, '--skip');
  const chosen = cases.filter((c) => (!only.length || only.some((e) => matches(e, c)))
    && !skip.some((e) => matches(e, c)));
  if (!chosen.length) throw new SetupError('no-cases', 'no cases left after --only and --skip');
  return { cases: chosen, overridden };
}

/** JSON with sorted keys, so the hash does not depend on key order in a file. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** sha256 of the canonical JSON of the chosen cases, in run order. */
export function corpusHash(cases) {
  return createHash('sha256').update(canonical(cases)).digest('hex');
}
