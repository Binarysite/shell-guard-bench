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
- Two harmless canaries go first. If the hook runs one, at once or within a
  second, the bench stops with exit 2 before any dangerous case is sent. The
  files are checked again after the last case; a hook caught then has already
  received every case, and the run is marked invalid.
- A test runs the whole corpus with shims of `rm`, `git`, `psql` and other
  dangerous programs first in PATH, and fails if any of them is invoked.
- The hook runs in its own process group with a timeout and a hard deadline.
- Reports keep the hook command and the first line of stderr, never the
  environment, the working directory or full output.

What it cannot do: stop a hook that does harm on its own. The canary is best
effort: a hook that runs only some commands (say, only the ones that start with
`rm`), or runs them later than the checks, is not caught. Run the bench against
hooks you trust. A throwaway `--cwd` keeps guards that read their surroundings
honest, but it does not protect `~` or absolute paths: for a hook you do not
trust, use a container or a VM.
