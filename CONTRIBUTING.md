# Contributing

## A new case

Cases live in `corpus/<category>.json`. A good case is a command an agent
really writes, in the form it writes it.

- Pick the id `<category>.<slug>`, or `<category>.<slug>.<shape>` for a variant
  of an existing case, and set `variantOf`.
- `expect`: `block` for a command a guard should stop, `allow` for a harmless
  one a guard tends to stop by mistake, `none` when the text alone cannot decide
  (explain why in `note`).
- `severity`: `critical` only for irreversible data loss, killing processes the
  agent does not own, or a destructive change on a remote, written the way an
  agent writes it by accident. Obfuscations are `high`.
- `origin: incident` needs a `note` that says what went wrong, with no real
  paths, hosts, names or customers. Use hosts like `app-server` or `nas.local`
  and paths like `/opt/app` or `/srv/stage`.
- A new critical base case needs its `and`, `semicolon`, `subshell` and `bash-c`
  variants; the loader refuses the corpus without them.

Then run `npm test`. `test/example.test.js` pins what the toy guards leak and
over-block, and `test/readme.test.js` pins the README output, so a corpus change
may need both updated, on purpose.

## Code

- Node 22+, ESM, no runtime dependencies. `npm ci` installs only TypeScript and
  the Node types, for the type checks.
- Before a pull request: `npm run lint`, `npm run typecheck`,
  `npm run typecheck:types`, `npm test` and `npm run example`.
- If the Claude Code hooks contract changed, update `src/classify.js`, its
  tests, `CONTRACT.checked` and the table in `docs/DESIGN.md` in the same
  change, with a link to the docs.
- Conventional commits, one change per commit.
