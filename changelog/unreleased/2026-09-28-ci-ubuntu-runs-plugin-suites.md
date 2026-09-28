# The ubuntu CI shards run the plugin suites

- **Date:** 2026-09-28
- **Type:** process
- **Scope:** `ci`

[中文版](2026-09-28-ci-ubuntu-runs-plugin-suites.zh.md)

The ubuntu `rest` test shard named its packages explicitly, so no package under `plugins/` ran its tests on Linux, while macOS and Windows ran them all. The Linux sandbox backends' live suites (`sandbox-bwrap`, `sandbox-dsh`), which skip everywhere but Linux, therefore ran nowhere.

## Details

- The ubuntu `rest` shard is now recursive with exclusions, like macOS and Windows: everything except core, server, web, ui and cli (which have shards of their own). A new package is scheduled by default instead of by remembering to list it.
- The shard builds `sandbox-bwrap`, so its live suite confines with the bwrap the plugin vendors rather than one on the runner's PATH.
- A step before the tests lifts Ubuntu 24.04's AppArmor restriction on unprivileged user namespaces for that shard, and prints the host's user-namespace settings and `bwrap` path, so a skipped live suite can be told apart from a refusal by the product.
