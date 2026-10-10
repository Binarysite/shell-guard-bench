// Diff of two reports by case id: a dangerous case that stops being contained, or a
// control that starts being blocked or asked, is a regression.
import { SCHEMA_VERSION } from './meta.js';

/** @type {Array<[string, (r: any) => unknown]>} */
const WATCHED = [
  ['corpus', (r) => r.provenance?.corpusHash],
  ['hook', (r) => r.provenance?.hook],
  ['contract date', (r) => r.contract?.checked],
  ['onFailure', (r) => r.provenance?.onFailure],
  ['permissionMode', (r) => r.provenance?.permissionMode],
];

const SHOW_IDS = 5;
/** @param {string[]} ids */
const few = (ids) => ids.slice(0, SHOW_IDS).join(', ') + (ids.length > SHOW_IDS ? ` and ${ids.length - SHOW_IDS} more` : '');

/** @param {any} report @param {string} side */
function check(report, side) {
  if (report?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(report.results)) {
    throw new TypeError(`${side}: not a shell-guard-bench report with schemaVersion ${SCHEMA_VERSION}`);
  }
}

/**
 * @param {import('../index.js').Report} before
 * @param {import('../index.js').Report} after
 */
export function compareReports(before, after) {
  check(before, 'before');
  check(after, 'after');
  const warnings = [];
  for (const [label, get] of WATCHED) {
    const [a, b] = [get(before), get(after)];
    if (a !== b) warnings.push(`${label} changed: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
  const old = new Map(before.results.map((r) => [r.id, r]));
  const now = new Map(after.results.map((r) => [r.id, r]));
  const onlyBefore = [...old.keys()].filter((id) => !now.has(id));
  const onlyAfter = [...now.keys()].filter((id) => !old.has(id));
  if (onlyBefore.length) warnings.push(`only in before: ${few(onlyBefore)}`);
  if (onlyAfter.length) warnings.push(`only in after: ${few(onlyAfter)}`);

  const regressions = [];
  const improvements = [];
  for (const [id, b] of old) {
    const a = now.get(id);
    if (!a) continue;
    const change = { id, expect: a.expect, severity: a.severity ?? null, from: b.outcome, to: a.outcome };
    if (a.expect === 'block' && b.contained !== a.contained) (a.contained ? improvements : regressions).push(change);
    if (a.expect === 'allow' && b.friction !== a.friction) (a.friction ? regressions : improvements).push(change);
  }
  return { regressions, improvements, warnings };
}
