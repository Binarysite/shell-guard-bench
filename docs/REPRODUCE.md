# Reproducing the cc-safety-net 2.7.12 measurement

The README tables come from three committed reports and three promise maps; a test ties them together. This page
re-runs the measurement. It runs a third-party guard, so do it in a throwaway directory and read
[SECURITY.md](../SECURITY.md#caveats) first.

Level: standard (default); for strict, add `CC_SAFETY_NET_LEVEL=strict`, use the
`cc-safety-net-2.7.12-strict` map and add the variable to `--record-env`:

```bash
CC_SAFETY_NET_HOME="$(mktemp -d)" CC_SAFETY_NET_AUDIT_HOME="$(mktemp -d)" CC_SAFETY_NET_NO_UPDATE_CHECK=1 \
  npx --yes github:Binarysite/shell-guard-bench#v0.2.1 \
  --hook "npx -y cc-safety-net@2.7.12 hook --coding-cli" --timeout 60 \
  --promise cc-safety-net-2.7.12-standard \
  --record-env CC_SAFETY_NET_HOME,CC_SAFETY_NET_AUDIT_HOME,CC_SAFETY_NET_NO_UPDATE_CHECK
```

With the official rulebooks: the four `rulebook.json` files of
[cc-safety-net/rulebooks](https://github.com/cc-safety-net/rulebooks) at commit `d1fc329f00f1c8068f0ce57a855508043981f7c7`
(`terraform`, `aws`, `gcloud`, `azure`) are plain JSON. They were downloaded without running `cc-safety-net rule add`
and placed where `rule add --global` puts them, `$CC_SAFETY_NET_HOME/rules/<name>/rulebook.json`, with a
`$CC_SAFETY_NET_HOME/rules/rule.json` that lists them:

```bash
export CC_SAFETY_NET_HOME="$(mktemp -d)" CC_SAFETY_NET_AUDIT_HOME="$(mktemp -d)" CC_SAFETY_NET_NO_UPDATE_CHECK=1
SHA=d1fc329f00f1c8068f0ce57a855508043981f7c7
for n in terraform aws gcloud azure; do
  mkdir -p "$CC_SAFETY_NET_HOME/rules/$n"
  curl -fsSL "https://raw.githubusercontent.com/cc-safety-net/rulebooks/$SHA/.cc-safety-net/rules/$n/rulebook.json" \
    -o "$CC_SAFETY_NET_HOME/rules/$n/rulebook.json"
done
cat > "$CC_SAFETY_NET_HOME/rules/rule.json" <<EOF
{ "version": 1, "rules": ["cc-safety-net/rulebooks#$SHA/terraform", "cc-safety-net/rulebooks#$SHA/aws",
  "cc-safety-net/rulebooks#$SHA/gcloud", "cc-safety-net/rulebooks#$SHA/azure"], "overrides": {}, "transparent_wrappers": [] }
EOF
npx --yes github:Binarysite/shell-guard-bench#v0.2.1 \
  --hook "npx -y cc-safety-net@2.7.12 hook --coding-cli" --timeout 60 \
  --promise cc-safety-net-2.7.12-rulebooks \
  --record-env CC_SAFETY_NET_HOME,CC_SAFETY_NET_AUDIT_HOME,CC_SAFETY_NET_NO_UPDATE_CHECK
```

The committed reports were measured on corpus v0.2.1 (201 cases), Node 22.22.0 on macOS, isolated, with no hook
failure, rewrite or ignored decision. A later corpus has a different hash, and a re-run on it gives different
totals than the README tables: compare the two reports with `guard-bench compare`, which warns when the corpus
changed.

Reports: [standard](../reports/cc-safety-net-2.7.12-2026-11-12-standard.json),
[strict](../reports/cc-safety-net-2.7.12-2026-11-12-strict.json),
[standard with the official rulebooks](../reports/cc-safety-net-2.7.12-2026-11-12-rulebooks.json). Reports of
earlier runs (2.6.7) are in [reports/archive/](../reports/archive/README.md).
