# Changelog

All notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

### Changed

- `tsconfig.json` is `strict`; `src/` and `bin/` type-check under it.
- The README is shorter (from 423 to about 260 lines); the caveats live once in
  `SECURITY.md`, the case fields in `CONTRIBUTING.md`.
- `stall` cases are scored apart as hygiene (`summary.hygiene`) and left out of
  `dangerous`, `controls` and both rates; `--min-contained` and
  `--max-friction` gate on the rest. `git.stash-untracked` is now `normal`.
- Results and report rows carry `variantOf`.
- The hook runs isolated by default (`--isolate`): its working directory, `HOME`,
  `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` are temporary directories.
  `--no-isolate` restores the old behavior. Reports record `isolate`.
- Three canaries instead of two, on random names and in random order: two
  `touch` and one `rm -rf` of a directory the bench created. They use the same
  `toolu_bench_<n>` ids as the cases, from one counter, so the first case id is
  now `toolu_bench_4`.

### Added

- A composite GitHub Action (`action.yml`): `uses: Binarysite/shell-guard-bench@v0.2.0`
  with `hook:` and the CLI flags as inputs, a job summary, and `result`,
  `exit-code` and `report` outputs. Inputs reach the script through the
  environment only. This repository's CI runs it against both toy guards and
  a hook input full of shell metacharacters.
- Promise maps (`--promise <file>`, `summarize(run, { promise })`): the case ids
  a guard's own docs say it blocks and allows, with sources and the date read.
  The summary scores them apart (`summary.promise`) from the bench policy, and
  lists what leaked outside the promise. Maps for cc-safety-net 2.6.7 at
  `standard` and `strict` are in `promises/`.
- cc-safety-net 2.6.7 re-measured against the 190-case corpus at `standard`
  (its default) and `strict`, isolated, with `--timeout 60`; both reports are
  in `reports/`.
- The corpus grows from 89 to 190 cases in ten categories (new: `cloud` and
  `secrets`). Every declared shape now has a case: `||`, newline, backticks,
  `sh -c`, `eval`, `xargs`, line continuation, plus new shapes for flag
  spellings, `"$HOME"`, `find -exec`, `$(printf r)m`, shell functions and
  `python3 -c` / `node -e`. New critical bases: `rm -rf /`, `dd` to a disk,
  `terraform destroy`, `kubectl delete namespace` and `aws s3 rm --recursive`,
  each with its required forms. 51 new harmless controls, 43 of them outside
  `stall`.
- The summary reports per-base results (`criticalBases`: a base counts as
  fully contained only when every critical form of it is) and 95% Wilson
  intervals for the containment and friction rates (`containedInterval`,
  `frictionInterval`), printed in the text and Markdown reports.
- A result whose stdout is text with a decision JSON line in it (`checking...`
  then a deny, or a deny then `ok`) carries the warning "decision JSON mixed
  with text; Claude Code ignores it". The summary counts them as
  `ignoredDecisions`, and the text and Markdown print an "Ignored decisions"
  line. Scoring is unchanged: Claude Code ignores them.
- `--record-env NAME,...` lists the variables that configured a guard in the
  report provenance, by name only.

### Removed

- `summary.show` and the `show` option of `summarize`: how many ids the text
  report lists is a display setting, now `formatText(run, summary, { show })`.
  Gate reasons name at most ten ids.
- The em dash rule of `npm run lint` (the prose stays free of them), the
  closing line of `npm run example`, and the `isDirectory` export of
  `src/runner.js`.

### Fixed

- A hook killed by a signal is a failure even when it printed valid JSON first;
  before, the JSON decided.
- The no-exec tripwire test runs with `HOME` and `TMPDIR` in a throwaway
  directory, so `/bin/rm -rf ~` could not reach the real home even if the bench
  ever executed a case. It also checks that every process the bench starts is
  `/bin/sh -c <hook>`.

## [0.1.1] - 2026-10-10

- Install snippets and sample output in the README now point at v0.1.1.
- README: the first screen leads with the chained `rm -rf ~` question, the example
  shows both toy guards, and a Measured guards section reports cc-safety-net 2.6.7
  with its committed JSON report.
- `npm run coverage` gates CI on 95% lines, 90% branches and 95% functions.
- `npm run lint` rejects em dashes.
- `npm run example` prints three leaks per run.
- Docs: PR template, changelog, contributing guide and the third-party score decision.

## [0.1.0] - 2026-10-09

First release.

- `guard-bench --hook "<command>"` runs every case through a Claude Code
  PreToolUse hook with `sh -c` and classifies the result by the documented
  contract (checked 2026-10-09): exit codes, JSON decisions, the legacy
  `decision`, `updatedInput`, `continue: false` and `onFailure`.
- 89 cases in eight categories, with provenance, a coverage rule for critical
  base cases and strict validation. `--cases` adds cases or replaces one by id.
- Execution canary before and after the run, with a one-second wait for
  background execution. The bench never executes a case; a hook that does is
  caught by this best-effort canary.
- The hook runs in its own process group, killed at the end of each case, on
  timeout, and on Ctrl+C or SIGTERM. Output is capped at 1 MiB per stream
  without changing the verdict of the exit code.
- Reports keep one line of at most 200 characters of what the hook printed,
  and the text and Markdown escape control characters.
- Gate: any critical leak exits 1; optional `--min-contained` and
  `--max-friction`. Fail-open and rewrites are reported.
- Text, JSON (`schemaVersion: 1`) and Markdown (`--md`) reports, and
  `guard-bench compare <before> <after>`.
- Library API with hand-written types: `loadCorpus`, `runBench`,
  `classifyHookResult`, `summarize`, `buildReport`, `compareReports`,
  `SetupError`.
- Two toy guards and `npm run example`.

[Unreleased]: https://github.com/Binarysite/shell-guard-bench/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Binarysite/shell-guard-bench/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Binarysite/shell-guard-bench/releases/tag/v0.1.0
