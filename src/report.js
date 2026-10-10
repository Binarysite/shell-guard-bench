// Text, JSON and Markdown views of a run. The text is deterministic: no timings,
// no absolute paths, no color, so two runs of the same guard diff cleanly.
import { readFileSync } from 'node:fs';
import { CONTRACT } from './classify.js';
import { corpusHash } from './corpus.js';
import { pct } from './text.js';

export const TOOL = Object.freeze({
  name: 'shell-guard-bench',
  version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
});
export const SCHEMA_VERSION = 1;
export const DEMO_LINE = 'One leaks, one cries wolf. Yours is somewhere in between; now you can see where.';

/** The first line of a command or reason for one line of the report, with how many lines were cut. */
const preview = (text, max = 70) => {
  const line = String(text).split('\n')[0];
  const cut = line.length > max ? `${line.slice(0, max - 3)}...` : line;
  return String(text).includes('\n') ? `${cut} [+${String(text).split('\n').length - 1} lines]` : cut;
};

/** Left-aligned columns, two spaces apart. */
function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

const TABLE_HEAD = ['category', 'dangerous', 'contained', 'leaked', 'controls', 'friction', 'not scored'];

function categoryRows(summary) {
  const rows = Object.entries(summary.byCategory).map(([name, c]) => [
    name, c.dangerous, c.contained, c.leaked, c.controls, c.friction, c.notScored,
  ]);
  rows.push([
    'total', summary.dangerous, `${summary.contained} (${pct(summary.containedRate)})`,
    summary.dangerous - summary.contained, summary.controls,
    `${summary.friction} (${pct(summary.frictionRate)})`, summary.notScored,
  ]);
  return rows;
}

/** @param {{ hook: string, results: unknown[] }} run */
export function header(run) {
  return `${TOOL.name} ${TOOL.version}  hook: ${run.hook}  cases: ${run.results.length}`
    + `  contract: Claude Code hooks (checked ${CONTRACT.checked})`;
}

/** One line per case, for --verbose. */
export function formatCase(r) {
  const sev = r.severity ? `[${r.severity}] ` : '';
  return `${r.outcome.padEnd(11)} ${r.expect.padEnd(5)}  ${sev}${r.id}  ${preview(r.command)}`;
}

function failOpenLine(summary) {
  const f = summary.failOpen;
  if (!f.count) return null;
  return `Fail-open: ${f.count} case(s) failed (${f.kinds.join(', ')}); with "onFailure": "block" they would be blocked.`;
}

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
 * @param {{ out?: string, withHeader?: boolean }} [opts] `out` is named when a list is cut
 */
export function formatText(run, summary, { out = 'the JSON report', withHeader = true } = {}) {
  const byId = new Map(run.results.map((r) => [r.id, r]));
  const lines = [...(withHeader ? [header(run), ''] : []), table([TABLE_HEAD, ...categoryRows(summary)]), ''];
  const c = summary.critical;
  lines.push(`Critical ${c.total}  contained ${c.contained}  leaked ${c.leaked.length}`);

  const list = (ids, render) => {
    for (const id of ids.slice(0, summary.show)) lines.push(render(byId.get(id)));
    if (ids.length > summary.show) lines.push(`  and ${ids.length - summary.show} more in ${out}`);
  };
  list(summary.leaked, (r) => `LEAKED      [${r.severity}] ${r.id}  ${preview(r.command)}  (${r.outcome})`);
  list(summary.frictionIds, (r) => `FRICTION    ${r.id}  ${preview(r.command)}  (${r.outcome}`
    + `${r.reason ? `: ${preview(r.reason, 80)}` : ''})`);
  for (const id of summary.notScoredIds) {
    const r = byId.get(id);
    lines.push(`NOT SCORED  ${r.id}  ${r.outcome}  ${r.note ?? ''}`.trimEnd());
  }
  for (const line of [failOpenLine(summary), rewritesLine(run, summary)]) if (line) lines.push(line);
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
      startedAt: run.startedAt,
    },
    ...(run.invalid ? { invalid: run.invalid } : {}),
    results: run.results.map((r) => ({
      id: r.id,
      category: r.category,
      expect: r.expect,
      severity: r.severity,
      origin: r.origin,
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
  const row = (cells) => `| ${cells.join(' | ')} |`;
  const ids = (list) => (list.length ? list.map((id) => `\`${id}\``).join(', ') : 'none');
  const lines = [
    `### ${TOOL.name}: ${summary.gate.pass ? 'PASS' : 'FAIL'}`,
    '',
    `Hook \`${run.hook}\`, ${run.results.length} cases, contract checked ${CONTRACT.checked}.`,
    '',
    row(TABLE_HEAD),
    row(TABLE_HEAD.map(() => '---')),
    ...categoryRows(summary).map(row),
    '',
    `Critical leaked: ${ids(summary.critical.leaked)}`,
    '',
    `Friction: ${ids(summary.frictionIds)}`,
  ];
  const failOpen = failOpenLine(summary);
  if (failOpen) lines.push('', failOpen);
  for (const reason of summary.gate.reasons) lines.push('', `- ${reason}`);
  return `${lines.join('\n')}\n`;
}

/**
 * @param {{ regressions: import('../index.js').Change[], improvements: import('../index.js').Change[],
 *   warnings: string[] }} result
 */
export function formatComparison(result) {
  const line = (c) => `  ${c.from.padEnd(11)} -> ${c.to.padEnd(11)} ${c.id}${c.severity ? `  [${c.severity}]` : ''}`;
  const lines = [];
  for (const w of result.warnings) lines.push(`warning: ${w}`);
  if (result.regressions.length) lines.push('Regressions:', ...result.regressions.map(line));
  if (result.improvements.length) lines.push('Improvements:', ...result.improvements.map(line));
  if (!result.regressions.length && !result.improvements.length) lines.push('No case changed side.');
  lines.push(`RESULT: ${result.regressions.length ? 'FAIL' : 'PASS'}`);
  return lines.join('\n');
}
