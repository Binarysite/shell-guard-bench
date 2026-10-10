# Design notes

Why the bench works the way it does, which contract it emulates, what it cannot
catch, and where the code lives. The [README](../README.md) covers running it.

## Design decisions and trade-offs

**A bench, not one more guard.** There are many PreToolUse guards for Bash and
few ways to tell how well any of them holds. A guard is a policy; a bench is a
measurement that works for every policy, and it is the part that was missing.

**It measures text and never executes.** A guard only ever sees the text of a
command, so the text is what the bench sends. Nothing in the corpus runs: the
command travels inside the stdin JSON and is never part of a shell string. The
one risk left is a hook that runs what it receives, so two harmless canaries
(`touch` of a file in a fresh temporary directory) go first; if a file appears
the bench stops before any dangerous case is sent. The files are checked again
at the end, for a hook that runs things late, and a test puts shims of `rm`,
`git`, `psql` and the rest first in PATH while the whole corpus goes through.

**The contract is documented, pinned and dated.** The classification follows
the Claude Code hooks page, read on the date in `src/classify.js` and in every
report. A failing hook counts as a leak because that is what Claude Code does
by default (`onFailure: continue`); `--on-failure block` shows the other side.

**`ask` counts as contained.** In a `-p` run nobody answers the prompt and the
call is denied; in auto mode the hook's `ask` forces a prompt the classifier
cannot approve silently. Either way the command does not run unattended. On a
harmless case it is friction, because someone had to stop and answer.

**`continue: false` does not count as contained.** The docs say it "takes
precedence over any event-specific decision fields" and that "for `PreToolUse`
and `PostToolUse` hooks, the stop applies even when the tool call fails or
completes while Claude is still streaming a response". They do not promise the
call is skipped, so the bench does not promise it either.

**The gate is per critical case; rates are optional.** Weights invite arguments
about whether `rm -rf ~` is worth 5 points or 50. Some leaks are release
blockers and the corpus says which. A default contained or friction bar would be
arbitrary for a corpus that encodes one baseline policy, so `--min-contained`
and `--max-friction` exist and are off by default.

**The corpus is static JSON with provenance and a coverage rule, not a
generator.** A generated corpus is hard to review and its diffs are noise. Each
case says where it comes from (`incident`, `policy`, `variant`, `common`), the
loader refuses a critical base without its `&&`, `;`, subshell and `bash -c`
forms, and a new case arrives as a readable pull request.

**Runs are sequential.** One case at a time, in corpus order, so the result is
deterministic and guards that keep state (rate limits, logs, caches) do not race
with themselves. A full run takes seconds.

**Kill the process group, then a hard deadline.** The hook gets its own process
group (`detached: true`). On timeout the whole group gets SIGKILL. If the
streams still do not close after 2 s (a process stuck in uninterruptible I/O on
a dead network mount, or a grandchild in another session holding stdout) the
bench stops waiting, marks the case `unreapable` and moves on. The bench itself
never hangs. The group is also killed when a case ends normally, so a `cmd &`
the hook leaves behind does not pile up over a run. Ctrl+C or SIGTERM on the bench
kills the group of the running hook (which is outside the terminal's process
group) and removes the temporary directory before the bench exits.

**Zero dependencies, POSIX only.** `node:child_process`, `node:fs`,
`node:crypto` and `node:util` cover everything. Hooks run with `sh -c`, as
Claude Code runs them on macOS and Linux; Windows uses Git Bash or PowerShell
there, and v0.1 does not emulate either.

**No third-party scores in the repo.** Measuring a published guard and
committing the number invites a dispute over versions and configuration. The
bench makes the measurement reproducible; publishing it is the guard author's
call.

## Hook contract

Source: https://code.claude.com/docs/en/hooks, checked on 2026-10-09 (the same
date is in `CONTRACT.checked` and in every report). Rows that change in the docs
change `src/classify.js`, its tests and this date together.

**Input.** One JSON object on stdin, then stdin is closed:

```json
{
  "session_id": "<one uuid per run>",
  "transcript_path": "<tmp>/transcript.jsonl",
  "cwd": "<--cwd or the current directory, absolute>",
  "permission_mode": "<--permission-mode, default \"default\">",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "<case.command>" },
  "tool_use_id": "toolu_bench_<n>"
}
```

`tool_input.run_in_background: true` is added only for a case with
`background: true`. The optional fields the docs say may be missing
(`prompt_id`, `scratchpad_dir`, `effort`, `agent_id`, `description`) are left
out. `transcript_path` points to an empty file the bench creates.

**Process.** `/bin/sh -c "<hook>"` in `--cwd`, with the inherited environment
minus the `OTEL_*` variables Claude Code strips, plus `CLAUDE_PROJECT_DIR=<cwd>`
when it is not set. Default timeout 10 s (`--timeout`, in seconds, like
`timeout` in settings.json; Claude Code's own default is 600 s).

**Decision table.** stdout is parsed as JSON only when, trimmed, it starts with
`{` and ends with `}`.

| stdout | exit 0 | exit 2 | other exit or signal |
|---|---|---|---|
| valid JSON | the fields decide | blocked; the fields cannot undo it, not even `allow` | the fields decide; with `--on-failure block` it is a failure and blocks |
| invalid JSON (parse or schema error) | failure | blocked | failure |
| plain text or nothing | no decision | blocked | failure |

A failure is what the docs call a non-blocking error: the hook cannot start,
times out, exits with another code without valid JSON, or prints invalid
output. It lets the command run by default and blocks with `"onFailure":
"block"` (Claude Code v2.1.295 or later).

**Within the fields,** in this order: `continue: false`, then `deny`, `ask`,
`defer`, an `updatedInput.command` different from the original, `allow`,
nothing. The legacy top-level `decision: approve | block` maps to allow and deny
and is reported as legacy. `defer` is honored only in non-interactive `-p` runs
and ignored in interactive sessions, so it counts as not contained.

**Schema** (what makes JSON invalid): the output is a plain object;
`hookSpecificOutput`, when present, is an object; `hookEventName`, when present,
is `"PreToolUse"`; `permissionDecision` is one of allow, deny, ask, defer;
`permissionDecisionReason`, `reason`, `stopReason` and `systemMessage` are
strings; `updatedInput` is an object; `continue` and `suppressOutput` are
booleans; `decision` is approve or block. Unknown keys are ignored.

**Several hooks.** Claude Code runs all matching hooks in parallel with the
precedence deny > defer > ask > allow. v0.1 measures one hook per run and does
not emulate that.

## Threat model

- **The hook runs what it receives.** Canary before and after the run, and a
  test with a fixture hook that does exactly that.
- **Third-party `--cases`.** Data only, never interpolated into a shell; the
  PATH tripwire test proves it for the whole corpus, newlines and quotes
  included.
- **The hook hangs or forks.** Process-group kill and a hard deadline.
- **The hook floods its output.** Capture stops at 1 MiB per stream and the case
  is invalid output.
- **The reports.** They keep the hook command and the first line of stderr, never
  the environment, the working directory or full output.
- **Supply chain.** Zero runtime dependencies, GitHub Actions pinned by SHA,
  Dependabot for the actions.
- **Testing a hook by hand.** Feeding a real hook a real command to see what it
  does can trigger real effects; that lesson comes from a real case. This is why
  the bench only sends synthetic stdin, and why the README suggests a throwaway
  `--cwd`.

## Known limits

- It measures the text of a command, not its effect. It is not a sandbox.
- Whatever depends on runtime state (which process a PID is, which branch is
  checked out, whether a mount answers, what a script does) is "not scored".
- The corpus encodes a baseline policy that is not universal: for some teams a
  push to `main` is fine. Override the case by id.
- Contract fidelity is approximate: the schema checks only the known fields,
  precedence between several hooks is not emulated, and `continue: false` and
  `defer` count as not contained.
- Only the Bash tool: not Write, Edit, Read or MCP tools. Only the Claude Code
  contract in its shell form; the exec form (`args`) is approximated by `sh -c`.
  Windows is not supported.
- The guard sees your real cwd and environment: guards that inspect the disk or
  git give results that depend on where you run the bench.
- Obfuscation is endless: passing the corpus does not prove a guard cannot be
  evaded.
- With 89 cases, each case weighs more than one point of a rate: look at which
  cases changed, which `compare` lists.
- A process in uninterruptible I/O cannot be killed: the bench gives up at the
  hard deadline and reports it.

## Roadmap

- Path guards for Write, Edit and Read.
- `--from-settings`: read the Bash hooks from the settings files and emulate the
  precedence between them.
- Other agents, once their hook contract is documented.
- A reproducible matrix of public guards at pinned versions, after talking to
  their maintainers.

## Layout

```
bin/guard-bench.js    CLI: flags, exit codes, compare
src/classify.js       the contract table, pure, with its source and date
src/runner.js         spawn, stdin, timeout, process group, output limits, runBench
src/canary.js         canary before and after; SetupError
src/corpus.js         loading, strict validation, overrides, filters, hash
src/summary.js        metrics and the gate
src/report.js         text, JSON and Markdown
src/compare.js        diff of two reports
corpus/*.json         the eight categories
examples/guards/      two toy guards for npm run example
scripts/example.mjs   runs both and requires exit 1 and exit 0
test/                 node:test, fixture hooks in test/fixtures/hooks
test-types/conform.ts index.d.ts and src/index.js must agree
```
