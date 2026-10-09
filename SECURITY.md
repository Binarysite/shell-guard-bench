# Security

shell-guard-bench sends dangerous shell commands to a hook as data and never
executes them. A bug that makes the bench run a case command, or that lets a
`--cases` file reach a shell, is a security issue.

## Reporting

Please report it privately through GitHub's
[private vulnerability reporting](https://github.com/Binarysite/shell-guard-bench/security/advisories/new)
rather than in a public issue. Include the command line, the hook and the case
that triggered it. You should get an answer within a week.

## What the bench does to stay safe

- Case commands only travel inside the JSON on the hook's stdin.
- Two harmless canaries go first; if the hook runs one, the bench stops with
  exit 2 before any dangerous case is sent, and the canaries are checked again
  at the end.
- A test runs the whole corpus with shims of `rm`, `git`, `psql` and other
  dangerous programs first in PATH, and fails if any of them is invoked.
- The hook runs in its own process group with a timeout and a hard deadline.
- Reports keep the hook command and the first line of stderr, never the
  environment, the working directory or full output.

What it cannot do: stop a hook that does harm on its own. Run the bench against
hooks you trust, ideally with `--cwd` pointing at a throwaway directory.
