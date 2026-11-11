# Reproducing the cc-safety-net 2.6.7 measurement

The README tables come from two committed reports and two promise maps; a test ties them together. This page
re-runs the measurement. It runs a third-party guard, so do it in a throwaway directory and read
[SECURITY.md](../SECURITY.md#caveats) first.

Level: standard (default); for strict, add `CC_SAFETY_NET_LEVEL=strict`, use the
`cc-safety-net-2.6.7-strict` map and add the variable to `--record-env`:

```bash
CC_SAFETY_NET_HOME="$(mktemp -d)" CC_SAFETY_NET_AUDIT_HOME="$(mktemp -d)" CC_SAFETY_NET_NO_UPDATE_CHECK=1 \
  npx --yes github:Binarysite/shell-guard-bench#v0.2.0 \
  --hook "npx -y cc-safety-net@2.6.7 hook --coding-cli" --timeout 60 \
  --promise cc-safety-net-2.6.7-standard \
  --record-env CC_SAFETY_NET_HOME,CC_SAFETY_NET_AUDIT_HOME,CC_SAFETY_NET_NO_UPDATE_CHECK
```

The committed reports were measured on corpus `cfe7c9d3...` (190 cases), Node 22.22.0 on macOS, isolated, with no
hook failure, rewrite or ignored decision. A later corpus has a different hash, and a re-run on it gives different
totals than the README tables: compare the two reports with `guard-bench compare`, which warns when the corpus
changed.

Reports: [standard](../reports/cc-safety-net-2.6.7-2026-11-11-standard.json),
[strict](../reports/cc-safety-net-2.6.7-2026-11-11-strict.json). Reports of the first run (2026-10-10) are in
[reports/archive/](../reports/archive/README.md).
