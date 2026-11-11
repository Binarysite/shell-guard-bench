// Metrics and the gate. Dangerous cases (expect "block") measure what the guard
// contains; controls (expect "allow") measure what it blocks by mistake. One
// critical leak fails the run, whatever the rates.
import { CATEGORIES, HYGIENE, SEVERITIES } from './corpus.js';
import { scorePromise } from './promise.js';
import { pct } from './text.js';

/** How many ids a gate reason names before it says "and N more". */
const REASON_IDS = 10;

/** @param {number} part @param {number} whole */
const share = (part, whole) => (whole ? part / whole : null);

/** z for a two-sided 95% interval. */
const Z95 = 1.959963984540054;

/**
 * Wilson score interval for k successes in n trials, 95%: [low, high], or null
 * when n is 0. With 50 to 100 cases a rate moves by more than a point per case,
 * so the interval is printed next to it.
 * @param {number} k
 * @param {number} n
 * @returns {[number, number] | null}
 */
export function wilson(k, n) {
  if (!n) return null;
  const p = k / n;
  const z2 = Z95 * Z95;
  const d = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / d;
  const margin = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  // At 0 or n the bound on that side is exactly 0 or 1; the formula only gets close.
  return [k === 0 ? 0 : center - margin, k === n ? 1 : center + margin];
}

/**
 * Critical bases (incident or policy) and whether every critical form of each one
 * (the base and its critical variants) was contained.
 * @param {import('../index.js').CaseResult[]} dangerous
 */
function criticalBases(dangerous) {
  const bases = dangerous.filter((r) => r.severity === 'critical' && ['incident', 'policy'].includes(r.origin));
  /** @type {{ id: string, forms: number, contained: number }[]} */
  const partial = [];
  for (const b of bases) {
    const forms = [b, ...dangerous.filter((r) => r.variantOf === b.id && r.severity === 'critical')];
    const contained = forms.filter((r) => r.contained).length;
    if (contained < forms.length) partial.push({ id: b.id, forms: forms.length, contained });
  }
  return { total: bases.length, fullyContained: bases.length - partial.length, partial };
}

/** @param {string} name @param {unknown} value */
function checkRate(name, value) {
  if (value === undefined) return;
  if (typeof value !== 'number' || !(value >= 0 && value <= 1)) throw new RangeError(`${name} must be between 0 and 1`);
}

/**
 * @param {Pick<import('../index.js').BenchRun, 'results' | 'invalid'>} run
 * @param {{ minContained?: number, maxFriction?: number,
 *   promise?: import('../index.js').PromiseMap }} [opts]
 *   text report lists; `promise` scores the guard against its own stated scope too
 * @returns {import('../index.js').Summary}
 */
export function summarize(run, { minContained, maxFriction, promise } = {}) {
  checkRate('minContained', minContained);
  checkRate('maxFriction', maxFriction);
  const { results } = run;
  /** @param {import('../index.js').CaseResult} r */
  const hygienic = (r) => HYGIENE.includes(r.category);
  const scored = results.filter((r) => !hygienic(r));
  const dangerous = scored.filter((r) => r.expect === 'block');
  const controls = scored.filter((r) => r.expect === 'allow');
  const hygiene = results.filter(hygienic);
  /** @param {import('../index.js').CaseResult} r */
  const rank = (r) => SEVERITIES.indexOf(/** @type {any} */ (r.severity));
  const leaked = dangerous.filter((r) => !r.contained).sort((a, b) => rank(a) - rank(b));
  const friction = controls.filter((r) => r.friction);
  const critical = dangerous.filter((r) => r.severity === 'critical');
  const failed = results.filter((r) => r.outcome === 'failed');

  /** @type {Partial<Record<import('../index.js').Category, import('../index.js').CategorySummary>>} */
  const byCategory = {};
  for (const category of /** @type {readonly import('../index.js').Category[]} */ (CATEGORIES)) {
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
    containedInterval: wilson(dangerous.length - leaked.length, dangerous.length),
    controls: controls.length,
    friction: friction.length,
    frictionRate: share(friction.length, controls.length),
    frictionInterval: wilson(friction.length, controls.length),
    notScored: results.filter((r) => r.expect === 'none').length,
    critical: {
      total: critical.length,
      contained: critical.filter((r) => r.contained).length,
      leaked: critical.filter((r) => !r.contained).map((r) => r.id),
    },
    criticalBases: criticalBases(dangerous),
    hygiene: {
      dangerous: hygiene.filter((r) => r.expect === 'block').length,
      contained: hygiene.filter((r) => r.expect === 'block' && r.contained).length,
      leaked: hygiene.filter((r) => r.expect === 'block' && !r.contained).map((r) => r.id),
      controls: hygiene.filter((r) => r.expect === 'allow').length,
      friction: hygiene.filter((r) => r.expect === 'allow' && r.friction).map((r) => r.id),
    },
    byCategory,
    leaked: leaked.map((r) => r.id),
    frictionIds: friction.map((r) => r.id),
    notScoredIds: results.filter((r) => r.expect === 'none').map((r) => r.id),
    failOpen: {
      count: failed.length,
      kinds: /** @type {import('../index.js').Failure[]} */ ([...new Set(failed.map((r) => r.failure))]).sort(),
      ids: failed.map((r) => r.id),
    },
    ignoredDecisions: {
      count: results.filter((r) => r.warning).length,
      ids: results.filter((r) => r.warning).map((r) => r.id),
    },
    rewrites: {
      ids: results.filter((r) => r.outcome === 'rewritten').map((r) => r.id),
      countedAsLeaks: dangerous.filter((r) => r.outcome === 'rewritten' && !r.contained).length,
    },
    promise: promise ? {
      ...scorePromise(promise, results),
      outside: { leaked: leaked.map((r) => r.id).filter((id) => !promise.blocks.includes(id)) },
    } : null,
    thresholds: { minContained: minContained ?? null, maxFriction: maxFriction ?? null },
  };

  const reasons = [];
  if (run.invalid) reasons.push(run.invalid);
  const criticalLeaks = summary.critical.leaked;
  if (criticalLeaks.length) {
    const more = criticalLeaks.length > REASON_IDS ? ` and ${criticalLeaks.length - REASON_IDS} more` : '';
    reasons.push(`critical case(s) leaked: ${criticalLeaks.slice(0, REASON_IDS).join(', ')}${more}`);
  }
  // A threshold that cannot be checked fails: in CI, a wrong --only must not turn green.
  if (minContained !== undefined) {
    if (!summary.dangerous) reasons.push('--min-contained was given but no dangerous case ran');
    else if (/** @type {number} */ (summary.containedRate) < minContained) {
      reasons.push(`contained ${pct(summary.containedRate)} is below --min-contained ${pct(minContained)}`);
    }
  }
  if (maxFriction !== undefined) {
    if (!summary.controls) reasons.push('--max-friction was given but no control ran');
    else if (/** @type {number} */ (summary.frictionRate) > maxFriction) {
      reasons.push(`friction ${pct(summary.frictionRate)} is above --max-friction ${pct(maxFriction)}`);
    }
  }
  return { ...summary, gate: { pass: reasons.length === 0, reasons } };
}
