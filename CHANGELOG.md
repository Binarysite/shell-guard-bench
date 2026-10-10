# Changelog

## 0.1.0 (2026-10-09)

First release.

- `guard-bench --hook "<command>"` runs every case through a Claude Code
  PreToolUse hook with `sh -c` and classifies the result by the documented
  contract (checked 2026-10-09): exit codes, JSON decisions, the legacy
  `decision`, `updatedInput`, `continue: false` and `onFailure`.
- 89 cases in eight categories, with provenance, a coverage rule for critical
  base cases and strict validation. `--cases` adds cases or replaces one by id.
- Execution canary before and after the run, with a one-second wait for
  background execution; no case command is ever executed.
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
