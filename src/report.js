// Text, JSON and Markdown views of a run. The text is deterministic: no timings,
// no absolute paths, no color, so two runs of the same guard diff cleanly.
import { CONTRACT, MIXED_WARNING } from './classify.js';
import { HYGIENE, corpusHash } from './corpus.js';
import { SCHEMA_VERSION, TOOL } from './meta.js';
import { pct, printable } from './text.js';

/** How many leaked and friction cases the text report lists by default (--show). */
export const SHOW_DEFAULT = 10;

/**
 * The first line of a command or reason for one line of the report, with how many lines were cut.
 * @param {unknown} text
 * @param {number} [max]
 */
const preview = (text, max = 70) => {
  const lines = String(text).split('\n');
  const line = printable(lines[0]);
  const cut = line.length > max ? `${line.slice(0, max - 3)}...` : line;
  return lines.length > 1 ? `${cut} [+${lines.length - 1} lines]` : cut;
};

/**
 * A Markdown code span that holds any text, backticks included.
 * @param {unknown} text
 */
const code = (text) => {
  const t = printable(text);
  const longest = Math.max(0, ...(t.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  return longest ? `${fence} ${t} ${fence}` : `${fence}${t}${fence}`;
};

/**
 * Left-aligned columns, two spaces apart.
 * @param {(string | number)[][]} rows
 */
function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

const TABLE_HEAD = ['category', 'dangerous', 'contained', 'leaked', 'controls', 'friction', 'not scored'];

/**
 * Category rows, the total of the scored ones, then the hygiene rows, which the total leaves out.
 * @param {import('../index.js').Summary} summary
 */
function categoryRows(summary) {
  /** @param {[string, import('../index.js').CategorySummary]} entry */
  const row = ([name, c]) => [name, c.dangerous, c.contained, c.leaked, c.controls, c.friction, c.notScored];
  const entries = Object.entries(summary.byCategory);
  const rows = entries.filter(([name]) => !HYGIENE.includes(name)).map(row);
  const scoredNotScored = rows.reduce((n, r) => n + Number(r[6]), 0);
  rows.push([
    'total', summary.dangerous, `${summary.contained} (${pct(summary.containedRate)})`,
    summary.dangerous - summary.contained, summary.controls,
    `${summary.friction} (${pct(summary.frictionRate)})`, scoredNotScored,
  ]);
  for (const [name, c] of entries.filter(([n]) => HYGIENE.includes(n))) rows.push(row([`${name} (hygiene)`, c]));
  return rows;
}

/**
 * "49 of 69 (71.0%, 95% CI 59.4% to 80.4%)"
 * @param {number} part
 * @param {number} whole
 * @param {number | null} value
 * @param {import('../index.js').Interval} interval
 */
const rate = (part, whole, value, interval) => `${part} of ${whole} (${pct(value)}`
  + `${interval ? `, 95% CI ${pct(interval[0])} to ${pct(interval[1])}` : ''})`;

/** @param {import('../index.js').Summary} summary */
function rateLine(summary) {
  return `Contained ${rate(summary.contained, summary.dangerous, summary.containedRate, summary.containedInterval)}`
    + `; friction ${rate(summary.friction, summary.controls, summary.frictionRate, summary.frictionInterval)}`;
}

/** @param {import('../index.js').Summary} summary @param {number} show */
function basesLine(summary, show) {
  const b = summary.criticalBases;
  const partial = b.partial.slice(0, show).map((p) => `${p.id} ${p.contained}/${p.forms}`);
  const more = b.partial.length > show ? ` and ${b.partial.length - show} more` : '';
  return `Critical bases ${b.total}  fully contained ${b.fullyContained}`
    + `${partial.length ? `  partial: ${partial.join(', ')}${more}` : ''}`;
}

/** @param {import('../index.js').Summary} summary */
function hygieneLine(summary) {
  const h = summary.hygiene;
  if (!h.dangerous && !h.controls) return null;
  return `Hygiene (${HYGIENE.join(', ')}, not in the rates): ${h.contained} of ${h.dangerous} contained, `
    + `${h.friction.length} of ${h.controls} controls blocked`;
}

/** @param {{ hook: string, results: unknown[] }} run */
export function header(run) {
  return `${TOOL.name} ${TOOL.version}  hook: ${printable(run.hook)}  cases: ${run.results.length}`
    + `  contract: Claude Code hooks (checked ${CONTRACT.checked})`;
}

/**
 * One line per case, for --verbose.
 * @param {import('../index.js').CaseResult} r
 */
export function formatCase(r) {
  const sev = r.severity ? `[${r.severity}] ` : '';
  return `${r.outcome.padEnd(11)} ${r.expect.padEnd(5)}  ${sev}${r.id}  ${preview(r.command)}`;
}

/** @param {import('../index.js').Summary} summary */
function failOpenLine(summary) {
  const f = summary.failOpen;
  if (!f.count) return null;
  return `Fail-open: ${f.count} case(s) failed (${f.kinds.join(', ')}); with "onFailure": "block" they would be blocked.`;
}

/** @param {import('../index.js').Summary} summary @param {(ids: string[]) => string} ids */
function ignoredLine(summary, ids) {
  const d = summary.ignoredDecisions;
  if (!d?.count) return null;
  return `Ignored decisions: ${d.count} (${MIXED_WARNING}): ${ids(d.ids)}`;
}

/**
 * The promise score, as lines of text; empty without a promise map.
 * @param {import('../index.js').Summary} summary
 * @param {(ids: string[]) => string} list
 */
function promiseLines(summary, list) {
  const p = summary.promise;
  if (!p) return [];
  const lines = [`Promise of ${printable(p.guard)}${p.level ? ` (${printable(p.level)})` : ''}: `
    + `${p.blocks.contained} of ${p.blocks.total} promised blocks contained, `
    + `${p.allows.friction.length} of ${p.allows.total} promised allows blocked`];
  if (p.blocks.leaked.length) lines.push(`  leaked inside the promise: ${list(p.blocks.leaked)}`);
  if (p.allows.friction.length) lines.push(`  blocked inside the promise: ${list(p.allows.friction)}`);
  if (p.notRun.length) lines.push(`  not run: ${p.notRun.length}`);
  lines.push(`Outside the promise, by this bench's policy: ${p.outside.leaked.length} leaked`);
  return lines;
}

/** @param {import('../index.js').BenchRun} run @param {import('../index.js').Summary} summary */
function rewritesLine(run, summary) {
  const n = summary.rewrites.ids.length;
  if (!n) return null;
  if (run.acceptRewrites) return `Rewrites: ${n} counted as contained (--accept-rewrites); review them.`;
  return `Rewrites: ${summary.rewrites.countedAsLeaks} counted as leaks; review them, then use --accept-rewrites.`;
}

/**
 * The text report printed after a run.
 * @param {import('../index.js').BenchRun} run
 * @param {import('../index.js').Summary} summary
 * @param {{ out?: string, withHeader?: boolean, show?: number }} [opts] `out` is named when a list is
 *   cut; `show` is how many leaked and friction cases are listed
 */
export function formatText(run, summary, { out = 'the JSON report', withHeader = true, show = SHOW_DEFAULT } = {}) {
  const byId = new Map(run.results.map((r) => [r.id, r]));
  const lines = [...(withHeader ? [header(run), ''] : []), table([TABLE_HEAD, ...categoryRows(summary)]), ''];
  const c = summary.critical;
  lines.push(rateLine(summary));
  lines.push(`Critical ${c.total}  contained ${c.contained}  leaked ${c.leaked.length}`);
  lines.push(basesLine(summary, show));
  const hygiene = hygieneLine(summary);
  if (hygiene) lines.push(hygiene);

  /** @param {string[]} ids @param {(r: import('../index.js').CaseResult) => string} render */
  const list = (ids, render) => {
    for (const id of ids.slice(0, show)) lines.push(render(/** @type {import('../index.js').CaseResult} */ (byId.get(id))));
    if (ids.length > show) lines.push(`  and ${ids.length - show} more in ${out}`);
  };
  list(summary.leaked, (r) => `LEAKED      [${r.severity}] ${r.id}  ${preview(r.command)}  (${r.outcome})`);
  list(summary.frictionIds, (r) => `FRICTION    ${r.id}  ${preview(r.command)}  (${r.outcome}`
    + `${r.reason ? `: ${preview(r.reason, 80)}` : ''})`);
  for (const id of summary.notScoredIds) {
    const r = /** @type {import('../index.js').CaseResult} */ (byId.get(id));
    lines.push(`NOT SCORED  ${r.id}  ${r.outcome}  ${printable(r.note ?? '')}`.trimEnd());
  }
  const failOpen = failOpenLine(summary);
  if (failOpen) {
    // The reason of the first failure, so a schema error does not need the JSON file to be found.
    const first = /** @type {import('../index.js').CaseResult} */ (byId.get(summary.failOpen.ids[0]));
    lines.push(failOpen, `  first: ${first.id}: ${preview(first.reason ?? first.failure, 100)}`);
  }
  const ignored = ignoredLine(summary, (ids) => ids.slice(0, show).join(', ')
    + (ids.length > show ? ` and ${ids.length - show} more` : ''));
  if (ignored) lines.push(ignored);
  lines.push(...promiseLines(summary, (ids) => ids.slice(0, show).join(', ')
    + (ids.length > show ? ` and ${ids.length - show} more` : '')));
  const rewrites = rewritesLine(run, summary);
  if (rewrites) lines.push(rewrites);
  lines.push(`RESULT: ${summary.gate.pass ? 'PASS' : 'FAIL'}`);
  for (const reason of summary.gate.reasons) lines.push(`  - ${reason}`);
  return lines.join('\n');
}

/**
 * The JSON report. It keeps the hook command and one line of at most 200 characters
 * of the hook's stderr, reason and rewritten command, never the environment, the
 * working directory or full output.
 * @param {import('../index.js').BenchRun} run
 * @param {import('../index.js').Summary} summary
 * @returns {import('../index.js').Report}
 */
export function buildReport(run, summary) {
  const { gate, ...rest } = summary;
  return {
    schemaVersion: SCHEMA_VERSION,
    tool: { ...TOOL },
    contract: { ...CONTRACT },
    provenance: {
      hook: run.hook,
      corpusHash: corpusHash(run.cases),
      cases: run.results.length,
      node: process.version,
      platform: process.platform,
      permissionMode: run.permissionMode,
      onFailure: run.onFailure,
      acceptRewrites: run.acceptRewrites,
      isolate: run.isolate,
      recordedEnv: run.recordedEnv,
      startedAt: run.startedAt,
    },
    ...(run.invalid ? { invalid: run.invalid } : {}),
    results: run.results.map((r) => ({
      id: r.id,
      category: r.category,
      expect: r.expect,
      severity: r.severity,
      origin: r.origin,
      variantOf: r.variantOf ?? null,
      outcome: r.outcome,
      contained: r.contained,
      friction: r.friction,
      failure: r.failure,
      reason: r.reason,
      exitCode: r.exitCode,
      signal: r.signal,
      timedOut: r.timedOut,
      ...(r.unreapable ? { unreapable: true } : {}),
      ...(r.legacy ? { legacy: true } : {}),
      ...(r.warning ? { warning: r.warning } : {}),
      rewrittenCommand: r.rewrittenCommand ?? null,
      durationMs: r.durationMs,
      stderrFirstLine: r.stderrFirstLine,
    })),
    summary: rest,
    gate,
  };
}

/**
 * Markdown for a CI job summary; the CLI appends it to the --md file.
 * @param {import('../index.js').BenchRun} run
 * @param {import('../index.js').Summary} summary
 */
export function formatMarkdown(run, summary) {
  /** @param {(string | number)[]} cells */
  const row = (cells) => `| ${cells.join(' | ')} |`;
  /** @param {string[]} list */
  const ids = (list) => (list.length ? list.map((id) => `\`${id}\``).join(', ') : 'none');
  const lines = [
    `### ${TOOL.name}: ${summary.gate.pass ? 'PASS' : 'FAIL'}`,
    '',
    `Hook ${code(run.hook)}, ${run.results.length} cases, contract checked ${CONTRACT.checked}.`,
    '',
    row(TABLE_HEAD),
    row(TABLE_HEAD.map(() => '---')),
    ...categoryRows(summary).map(row),
    '',
    `${rateLine(summary)}.`,
    '',
    `${basesLine(summary, Infinity)}.`,
    '',
    `Critical leaked: ${ids(summary.critical.leaked)}`,
    '',
    `Friction: ${ids(summary.frictionIds)}`,
  ];
  const hygiene = hygieneLine(summary);
  if (hygiene) lines.push('', `${hygiene}.`);
  const failOpen = failOpenLine(summary);
  if (failOpen) lines.push('', failOpen);
  const ignored = ignoredLine(summary, ids);
  if (ignored) lines.push('', ignored);
  const p = summary.promise;
  if (p) {
    const [head] = promiseLines(summary, ids);
    const inside = p.blocks.leaked.length ? ` Leaked inside the promise: ${ids(p.blocks.leaked)}.` : '';
    const blocked = p.allows.friction.length ? ` Blocked inside the promise: ${ids(p.allows.friction)}.` : '';
    lines.push('', `${head}.${inside}${blocked} Outside the promise, by this bench's policy: `
      + `${p.outside.leaked.length} leaked.`);
  }
  for (const reason of summary.gate.reasons) lines.push('', `- ${reason}`);
  return `${lines.join('\n')}\n`;
}

/**
 * @param {{ regressions: import('../index.js').Change[], improvements: import('../index.js').Change[],
 *   warnings: string[] }} result
 */
export function formatComparison(result) {
  /** @param {import('../index.js').Change} c */
  const line = (c) => printable(`  ${c.from.padEnd(11)} -> ${c.to.padEnd(11)} ${c.id}${c.severity ? `  [${c.severity}]` : ''}`);
  /** @type {string[]} */
  const lines = [];
  for (const w of result.warnings) lines.push(`warning: ${printable(w)}`);
  if (result.regressions.length) lines.push('Regressions:', ...result.regressions.map(line));
  if (result.improvements.length) lines.push('Improvements:', ...result.improvements.map(line));
  if (!result.regressions.length && !result.improvements.length) lines.push('No case changed side.');
  lines.push(`RESULT: ${result.regressions.length ? 'FAIL' : 'PASS'}`);
  return lines.join('\n');
}
