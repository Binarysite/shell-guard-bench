#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadCorpus, runBench, summarize, compareReports, SetupError } from '../src/index.js';
import { ON_FAILURE, PERMISSION_MODES, RUN_DEFAULTS, isDirectory } from '../src/runner.js';
import { SHOW_DEFAULT } from '../src/summary.js';
import { TOOL } from '../src/meta.js';
import { buildReport, formatCase, formatComparison, formatMarkdown, formatText, header } from '../src/report.js';

const OUT = 'reports/guard-bench.json';

const HELP = `Usage: guard-bench --hook "<command>" [options]
       guard-bench compare <before.json> <after.json>

      --hook <command>        hook to test, run with sh -c like the "command" of a
                              settings.json hook (required)
  -c, --cases <file>          extra cases, a JSON array; an existing id replaces the
                              bundled case (repeatable)
      --only <list>           only these categories or id prefixes, comma separated
      --skip <list>           skip these categories or id prefixes
      --cwd <dir>             working directory of the hook and the "cwd" field
      --timeout <seconds>     per case (default ${RUN_DEFAULTS.timeoutSec}; Claude Code's default is 600)
      --permission-mode <m>   ${PERMISSION_MODES.slice(0, 5).join(' | ')} |
                              ${PERMISSION_MODES.slice(5).join(' | ')} (default "${RUN_DEFAULTS.permissionMode}")
      --on-failure <mode>     ${ON_FAILURE.join(' | ')}, as the hook's onFailure setting
                              (default ${RUN_DEFAULTS.onFailure}, which lets the command run)
      --accept-rewrites       count an updatedInput rewrite of a dangerous command
                              as contained
      --min-contained <x>     share of dangerous cases that must be contained, 0..1
      --max-friction <x>      share of harmless cases that may be blocked or asked, 0..1
      --show <n>              leaked and friction cases printed (default ${SHOW_DEFAULT})
  -o, --out <file>            JSON report (default ${OUT})
      --md <file>             append a Markdown summary, e.g. "$GITHUB_STEP_SUMMARY"
  -v, --verbose               print every case
  -h, --help
      --version

Exit codes: 0 gate passed, 1 gate failed, 2 usage or setup error.
compare exits 1 when a contained dangerous case leaks or a harmless case
starts being blocked or asked.`;

class UsageError extends Error {}

function toNumber(name, value, { min = 0, max = Infinity, integer = false, above = false } = {}) {
  const n = Number(value);
  const ok = value !== '' && Number.isFinite(n) && (above ? n > min : n >= min) && n <= max
    && (!integer || Number.isInteger(n));
  if (!ok) {
    const range = max === Infinity ? `${above ? 'greater than' : 'at least'} ${min}` : `between ${min} and ${max}`;
    throw new UsageError(`--${name} must be ${integer ? 'an integer' : 'a number'} ${range}`);
  }
  return n;
}

/** Runs a write and turns its failure into a usage error that names the file. */
async function writing(file, write) {
  try {
    await write();
  } catch (err) {
    throw new UsageError(`cannot write ${file}: ${err.message}`);
  }
}

const list = (value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []);

async function readReport(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    throw new UsageError(`${file}: ${err.code === 'ENOENT' ? 'file not found' : err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new UsageError(`${file}: invalid JSON: ${err.message}`);
  }
}

async function runCompare(files) {
  if (files.includes('-h') || files.includes('--help')) {
    console.log(HELP);
    return 0;
  }
  if (files.length !== 2) {
    throw new UsageError('compare needs two reports: guard-bench compare <before.json> <after.json>');
  }
  const [before, after] = await Promise.all(files.map(readReport));
  let result;
  try {
    result = compareReports(before, after);
  } catch (err) {
    throw new UsageError(err.message.replace(/^before/, files[0]).replace(/^after/, files[1]));
  }
  console.log(formatComparison(result));
  return result.regressions.length ? 1 : 0;
}

function parseCli(argv) {
  try {
    return parseArgs({
      args: argv,
      options: {
        hook: { type: 'string' },
        cases: { type: 'string', short: 'c', multiple: true, default: [] },
        only: { type: 'string' },
        skip: { type: 'string' },
        cwd: { type: 'string' },
        timeout: { type: 'string', default: String(RUN_DEFAULTS.timeoutSec) },
        'permission-mode': { type: 'string', default: RUN_DEFAULTS.permissionMode },
        'on-failure': { type: 'string', default: RUN_DEFAULTS.onFailure },
        'accept-rewrites': { type: 'boolean', default: false },
        'min-contained': { type: 'string' },
        'max-friction': { type: 'string' },
        show: { type: 'string', default: String(SHOW_DEFAULT) },
        out: { type: 'string', short: 'o', default: OUT },
        md: { type: 'string' },
        verbose: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', default: false },
      },
    }).values;
  } catch (err) {
    if (String(err.code).startsWith('ERR_PARSE_ARGS')) throw new UsageError(`${err.message} (see guard-bench --help)`);
    throw err;
  }
}

async function main(argv) {
  if (argv[0] === 'compare') return runCompare(argv.slice(1));
  const args = parseCli(argv);
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (args.version) {
    console.log(TOOL.version);
    return 0;
  }
  if (!args.hook?.trim()) throw new UsageError('--hook is required (see guard-bench --help)');
  if (!PERMISSION_MODES.includes(args['permission-mode'])) {
    throw new UsageError(`--permission-mode must be one of ${PERMISSION_MODES.join(', ')}`);
  }
  if (!ON_FAILURE.includes(args['on-failure'])) throw new UsageError(`--on-failure must be ${ON_FAILURE.join(' or ')}`);
  const timeoutSec = toNumber('timeout', args.timeout, { min: 0, max: 86_400, above: true });
  const show = toNumber('show', args.show, { integer: true });
  const rate = (name) => (args[name] === undefined ? undefined : toNumber(name, args[name], { max: 1 }));
  if (args.cwd !== undefined && !(await isDirectory(args.cwd))) {
    throw new UsageError(`--cwd ${args.cwd} is not a directory`);
  }
  const minContained = rate('min-contained');
  const maxFriction = rate('max-friction');

  // Fail on an unwritable report before the run, not after it printed a result.
  await writing(args.out, () => mkdir(dirname(resolve(args.out)), { recursive: true }));
  if (args.md) await writing(args.md, () => appendFile(args.md, ''));

  const { cases, overridden } = await loadCorpus({ extra: args.cases, only: list(args.only), skip: list(args.skip) });
  const verbose = args.verbose ? (r) => console.log(formatCase(r)) : undefined;
  console.log(header({ hook: args.hook, results: cases }));
  if (overridden.length) console.log(`Overridden by --cases: ${overridden.join(', ')}`);
  console.log('');
  const run = await runBench({
    hook: args.hook,
    cases,
    cwd: args.cwd,
    timeoutSec,
    permissionMode: /** @type {import('../index.js').PermissionMode} */ (args['permission-mode']),
    onFailure: /** @type {'continue' | 'block'} */ (args['on-failure']),
    acceptRewrites: args['accept-rewrites'],
    onResult: verbose,
  });
  const summary = summarize(run, { minContained, maxFriction, show });
  if (verbose) console.log('');
  console.log(formatText(run, summary, { out: args.out, withHeader: false }));

  await writing(args.out, () => writeFile(args.out, `${JSON.stringify(buildReport(run, summary), null, 2)}\n`));
  if (args.md) await writing(args.md, () => appendFile(args.md, formatMarkdown(run, summary)));
  console.log(`Report: ${args.out}`);
  if (run.invalid) return 2;
  return summary.gate.pass ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    const known = err instanceof UsageError || err instanceof SetupError;
    console.error(`guard-bench: ${known ? err.message : err.stack}`);
    process.exitCode = 2;
  },
);
