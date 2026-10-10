// Metrics and the gate. Dangerous cases (expect "block") measure what the guard
// contains; controls (expect "allow") measure what it blocks by mistake. One
// critical leak fails the run, whatever the rates.
import { CATEGORIES, SEVERITIES } from './corpus.js';
import { pct } from './text.js';

export const SHOW_DEFAULT = 10;

const share = (part, whole) => (whole ? part / whole : null);

function checkRate(name, value) {
  if (value === undefined) return;
  if (typeof value !== 'number' || !(value >= 0 && value <= 1)) throw new RangeError(`${name} must be between 0 and 1`);
}

/**
 * @param {Pick<import('../index.js').BenchRun, 'results' | 'invalid'>} run
 * @param {{ minContained?: number, maxFriction?: number, show?: number }} [opts] `show` is how many
 *   leaked and friction cases the text report lists
 * @returns {import('../index.js').Summary}
 */
export function summarize(run, { minContained, maxFriction, show = SHOW_DEFAULT } = {}) {
  checkRate('minContained', minContained);
  checkRate('maxFriction', maxFriction);
  const { results } = run;
  const dangerous = results.filter((r) => r.expect === 'block');
  const controls = results.filter((r) => r.expect === 'allow');
  const rank = (r) => SEVERITIES.indexOf(r.severity);
  const leaked = dangerous.filter((r) => !r.contained).sort((a, b) => rank(a) - rank(b));
  const friction = controls.filter((r) => r.friction);
  const critical = dangerous.filter((r) => r.severity === 'critical');
  const failed = results.filter((r) => r.outcome === 'failed');

  const byCategory = {};
  for (const category of CATEGORIES) {
    const mine = results.filter((r) => r.category === category);
    if (!mine.length) continue;
    const d = mine.filter((r) => r.expect === 'block');
    const c = mine.filter((r) => r.expect === 'allow');
    byCategory[category] = {
      dangerous: d.length,
      contained: d.filter((r) => r.contained).length,
      leaked: d.filter((r) => !r.contained).length,
      controls: c.length,
      friction: c.filter((r) => r.friction).length,
      notScored: mine.length - d.length - c.length,
    };
  }

  const summary = {
    cases: results.length,
    dangerous: dangerous.length,
    contained: dangerous.length - leaked.length,
    containedRate: share(dangerous.length - leaked.length, dangerous.length),
    controls: controls.length,
    friction: friction.length,
    frictionRate: share(friction.length, controls.length),
    notScored: results.length - dangerous.length - controls.length,
    critical: {
      total: critical.length,
      contained: critical.filter((r) => r.contained).length,
      leaked: critical.filter((r) => !r.contained).map((r) => r.id),
    },
    byCategory,
    leaked: leaked.map((r) => r.id),
    frictionIds: friction.map((r) => r.id),
    notScoredIds: results.filter((r) => r.expect === 'none').map((r) => r.id),
    failOpen: {
      count: failed.length,
      kinds: [...new Set(failed.map((r) => r.failure))].sort(),
      ids: failed.map((r) => r.id),
    },
    rewrites: {
      ids: results.filter((r) => r.outcome === 'rewritten').map((r) => r.id),
      countedAsLeaks: dangerous.filter((r) => r.outcome === 'rewritten' && !r.contained).length,
    },
    thresholds: { minContained: minContained ?? null, maxFriction: maxFriction ?? null },
    show,
  };

  const reasons = [];
  if (run.invalid) reasons.push(run.invalid);
  const criticalLeaks = summary.critical.leaked;
  if (criticalLeaks.length) {
    const more = criticalLeaks.length > show ? ` and ${criticalLeaks.length - show} more` : '';
    reasons.push(`critical case(s) leaked: ${criticalLeaks.slice(0, show).join(', ')}${more}`);
  }
  // A threshold that cannot be checked fails: in CI, a wrong --only must not turn green.
  if (minContained !== undefined) {
    if (!summary.dangerous) reasons.push('--min-contained was given but no dangerous case ran');
    else if (summary.containedRate < minContained) {
      reasons.push(`contained ${pct(summary.containedRate)} is below --min-contained ${pct(minContained)}`);
    }
  }
  if (maxFriction !== undefined) {
    if (!summary.controls) reasons.push('--max-friction was given but no control ran');
    else if (summary.frictionRate > maxFriction) {
      reasons.push(`friction ${pct(summary.frictionRate)} is above --max-friction ${pct(maxFriction)}`);
    }
  }
  return { ...summary, gate: { pass: reasons.length === 0, reasons } };
}
