# Security

shell-guard-bench sends dangerous shell commands to a hook as data. The bench
never executes a case; a hook that does is caught by a best-effort canary. A
bug that makes the bench run a case command, or that lets a `--cases` file or
an action input reach a shell, is a security issue.

## Reporting

Please report it privately through GitHub's
[private vulnerability reporting](https://github.com/Binarysite/shell-guard-bench/security/advisories/new)
rather than in a public issue. Include the command line, the hook and the case
that triggered it. You should get an answer within a week.

## What the bench does to stay safe

- Case commands only travel inside the JSON on the hook's stdin. Every process
  the bench starts is `/bin/sh -c <hook>`; a test checks that no case command
  reaches an argv.
- Three harmless canaries go first, on random names, in random order, with the
  same `tool_use_id` format as the cases: two create a file and one removes a
  directory the bench created. If the hook runs one, at once or within a
  second, the bench stops with exit 2 before any dangerous case is sent. They
  are checked again after the last case; a hook caught then has already
  received every case, and the run is marked invalid.
- By default (`--isolate`) the hook's working directory, `HOME`,
  `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` are temporary directories, removed
  after the run.
- A test runs the whole corpus with shims of `rm`, `git`, `psql`, `bash`,
  `curl` and the other programs the corpus names first in PATH, and `HOME` and
  `TMPDIR` in a throwaway directory, and fails if any shim runs or the fake
  home changes.
- The hook runs in its own process group with a timeout and a hard deadline.
- Reports keep the hook command and one line of at most 200 characters of the
  hook's stderr, reason and rewritten command, never the environment, the
  working directory or full output. `--record-env` keeps variable names only.
- The GitHub Action passes every input to its script through the environment,
  never by pasting it into the script; a CI job checks it with `$( )` and
  backticks in the hook input.

## Caveats

These are the limits of the bench, stated once here; the README and
`docs/DESIGN.md` link to this list.

- **Not a sandbox.** The canary is best effort: a hook that runs only some
  commands (say, only `git`), or runs them later than the checks, is not
  caught. Isolation covers `HOME`, the XDG directories and the working
  directory, not absolute paths, the network or the rest of the environment.
  For a hook you do not trust, use a container or a VM.
- **The environment is inherited.** The hook gets the bench's environment,
  secrets of a CI job included, as it would in Claude Code.
- **The hook command is kept as written.** `--hook "$HOME/..."` puts an
  absolute path with your user name into the JSON, the text and the `--md`
  summary; in a public CI, use a path relative to the repository.
- **It measures text, not effects**, of the Bash tool only, under the Claude
  Code hooks contract as documented on the date in every report, on POSIX
  systems. The contract emulation has not been compared with a real Claude
  Code session yet.
- **A measurement is one guard version, one configuration, one corpus, one
  day.** Passing the corpus does not prove a guard cannot be evaded.
