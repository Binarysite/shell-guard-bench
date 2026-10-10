// Public contracts of shell-guard-bench (src/index.js).
// The JSDoc in src/ is the source of truth; `npm run typecheck` checks both and,
// through test-types/conform.ts, that src/index.js provides what this file declares.

export type Category = 'delete' | 'kill' | 'sync' | 'git' | 'deploy' | 'database' | 'privilege' | 'stall';
/** `none` cases are run and printed but not scored. */
export type Expect = 'block' | 'allow' | 'none';
export type Severity = 'critical' | 'high' | 'normal';
export type Origin = 'incident' | 'policy' | 'variant' | 'common';
export type Shape =
  | 'plain' | 'and' | 'or' | 'semicolon' | 'newline' | 'pipe' | 'subshell' | 'backticks' | 'bash-c' | 'sh-c'
  | 'eval' | 'ssh' | 'sudo' | 'env-prefix' | 'abs-path' | 'builtin-bypass' | 'xargs' | 'find' | 'heredoc'
  | 'refspec' | 'comment' | 'mention-echo' | 'mention-grep' | 'quote-split' | 'var-indirection' | 'base64-pipe'
  | 'line-continuation' | 'background';
export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'auto' | 'dontAsk' | 'bypassPermissions';
export type OnFailure = 'continue' | 'block';

/** One corpus case. Unknown fields fail validation. */
export interface Case {
  /** `<category>.<slug>[.<shape>]`, unique; a --cases file with the same id replaces it. */
  id: string;
  category: Category;
  /** Never executed; it only travels inside the hook's stdin JSON. */
  command: string;
  expect: Expect;
  /** Required when expect is `block`, and only then. */
  severity?: Severity;
  origin: Origin;
  /** Required when origin is `variant`: a case of the same category and expect. */
  variantOf?: string;
  shape?: Shape;
  /** Sent as `tool_input.run_in_background: true`. */
  background?: boolean;
  platform?: 'any' | 'macos' | 'linux';
  /** At most 240 characters; required for origin `incident` and expect `none`. */
  note?: string;
}

export type Outcome =
  | 'blocked' | 'asked' | 'stopped' | 'rewritten' | 'allowed' | 'deferred' | 'passthrough' | 'failed';
export type Failure = 'cannot-start' | 'timeout' | 'exit-code' | 'invalid-output' | 'signal';

/** What one hook run means under the PreToolUse contract. */
export interface Verdict {
  outcome: Outcome;
  /** The command would not run (what matters for a dangerous case). */
  contained: boolean;
  /** The agent or a person was stopped (what matters for a harmless case). */
  friction: boolean;
  reason?: string;
  failure?: Failure;
  /** For `rewritten`: the new command, or null when updatedInput has none. */
  rewrittenCommand?: string | null;
  /** The deprecated top-level `decision: approve | block` decided. */
  legacy?: boolean;
}

/** What the runner observed; the input of classifyHookResult. */
export interface RawHookResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  spawnError?: Error;
  /** stdout went over 1 MiB: it was cut and is read as plain text. */
  overflow?: boolean;
  stdout: string;
  stderr: string;
}

export interface CaseResult {
  id: string;
  category: Category;
  expect: Expect;
  severity: Severity | null;
  origin: Origin;
  command: string;
  note: string | null;
  outcome: Outcome;
  contained: boolean;
  friction: boolean;
  failure: Failure | null;
  reason: string | null;
  legacy: boolean;
  rewrittenCommand?: string | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  /** The process did not go away after the kill; the bench gave up waiting. */
  unreapable: boolean;
  durationMs: number;
  stderrFirstLine: string | null;
}

export interface BenchRun {
  hook: string;
  /** Absolute; kept out of the JSON report. */
  cwd: string;
  timeoutSec: number;
  permissionMode: PermissionMode;
  onFailure: OnFailure;
  acceptRewrites: boolean;
  startedAt: string;
  cases: Case[];
  results: CaseResult[];
  /** Set when a canary file appeared after the run: the results cannot be trusted. */
  invalid: string | null;
}

export interface CategorySummary {
  dangerous: number;
  contained: number;
  leaked: number;
  controls: number;
  friction: number;
  notScored: number;
}

export interface Summary {
  cases: number;
  dangerous: number;
  contained: number;
  /** null when there are no dangerous cases. */
  containedRate: number | null;
  controls: number;
  friction: number;
  /** null when there are no controls. */
  frictionRate: number | null;
  notScored: number;
  critical: { total: number; contained: number; leaked: string[] };
  byCategory: Partial<Record<Category, CategorySummary>>;
  /** Dangerous cases not contained, critical first. */
  leaked: string[];
  frictionIds: string[];
  notScoredIds: string[];
  failOpen: { count: number; kinds: Failure[]; ids: string[] };
  rewrites: { ids: string[]; countedAsLeaks: number };
  thresholds: { minContained: number | null; maxFriction: number | null };
  /** How many leaked and friction cases the text report lists. */
  show: number;
  gate: { pass: boolean; reasons: string[] };
}

export interface ReportResult {
  id: string;
  category: Category;
  expect: Expect;
  severity: Severity | null;
  origin: Origin;
  outcome: Outcome;
  contained: boolean;
  friction: boolean;
  failure: Failure | null;
  reason: string | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  unreapable?: true;
  legacy?: true;
  rewrittenCommand: string | null;
  durationMs: number;
  /** At most 200 characters. */
  stderrFirstLine: string | null;
}

/** The JSON report. It never holds the environment, the cwd or full output. */
export interface Report {
  schemaVersion: 1;
  tool: { name: string; version: string };
  contract: { source: string; checked: string };
  provenance: {
    hook: string;
    /** sha256 of the canonical JSON of the cases that ran. */
    corpusHash: string;
    cases: number;
    node: string;
    platform: string;
    permissionMode: PermissionMode;
    onFailure: OnFailure;
    acceptRewrites: boolean;
    startedAt: string;
  };
  invalid?: string;
  results: ReportResult[];
  summary: Omit<Summary, 'gate'>;
  gate: { pass: boolean; reasons: string[] };
}

export interface Change {
  id: string;
  expect: Expect;
  severity: Severity | null;
  from: Outcome;
  to: Outcome;
}

export type SetupErrorCode =
  | 'unsupported-platform' | 'no-cases' | 'invalid-case' | 'canary-executed' | 'hook-failed-on-canary';

export class SetupError extends Error {
  constructor(code: SetupErrorCode, message: string);
  code: SetupErrorCode;
}

export function loadCorpus(opts?: { extra?: string[]; only?: string[]; skip?: string[] }): Promise<{
  cases: Case[];
  /** Bundled ids replaced by a --cases file. */
  overridden: string[];
}>;

/** Throws SetupError (canary, no cases, invalid case, Windows). */
export function runBench(opts: {
  hook: string;
  cases: Case[];
  cwd?: string;
  /** Per case, default 10. */
  timeoutSec?: number;
  permissionMode?: PermissionMode;
  onFailure?: OnFailure;
  acceptRewrites?: boolean;
  /** How long to wait after the canaries and after the last case for a delayed execution, default 1000. */
  canaryGraceMs?: number;
  onResult?: (r: CaseResult) => void;
}): Promise<BenchRun>;

export function classifyHookResult(
  raw: RawHookResult,
  ctx: { command: string; onFailure?: OnFailure; acceptRewrites?: boolean },
): Verdict;

export function summarize(
  run: Pick<BenchRun, 'results' | 'invalid'>,
  opts?: { minContained?: number; maxFriction?: number; show?: number },
): Summary;

/** The JSON report the CLI writes to --out, for compareReports or your own storage. */
export function buildReport(run: BenchRun, summary: Summary): Report;

export function compareReports(before: Report, after: Report): {
  regressions: Change[];
  improvements: Change[];
  warnings: string[];
};
