# The ubuntu CI shards run the plugin suites, and a sandbox live suite CI requires cannot skip

- **Date:** 2026-09-28
- **Type:** process
- **Scope:** `ci`, `plugins/sandbox-bwrap`, `plugins/sandbox-dsh`, `plugins/sandbox-seatbelt`
- **PR:** [#872](https://github.com/Prism-Shadow/penguin-harness/pull/872)

[中文版](2026-09-28-ci-ubuntu-runs-plugin-suites.zh.md)

The ubuntu `rest` test shard named its packages explicitly, so no package under `plugins/` ran its tests on Linux, while macOS and Windows ran them all. The Linux sandbox backends' live suites (`sandbox-bwrap`, `sandbox-dsh`), which skip everywhere but Linux, therefore ran nowhere.

## Details

- The ubuntu `rest` shard is now recursive with exclusions, like macOS and Windows: everything except core, server, web, ui and cli (which have shards of their own). A new package is scheduled by default instead of by remembering to list it. Its build list is the one macOS and Windows use.
- `PENGUIN_SANDBOX_LIVE` (comma-separated backend names: `bwrap`, `dsh`, `seatbelt`) names the sandbox live suites a run requires. A named backend whose host probe fails now fails its live suite with the probe's reason (for bwrap on Ubuntu, the user-namespace switch it names) instead of skipping; an unnamed one skips where it cannot open, as before. CI sets it on the `rest` shard: ubuntu `bwrap,dsh`, macOS `seatbelt,dsh`.
- `sandbox-bwrap`'s tests fetch the bubblewrap the plugin ships when it is missing: a vitest global setup runs `scripts/vendor-bwrap.mjs` on Linux (pinned by sha256, cached under `node_modules/.cache`), does nothing when the binary is in place, and nothing off Linux. A test run alone now measures the binary users get, and CI no longer builds the plugin for it.
- A step before the tests on that shard, "Allow unprivileged user namespaces", sets `kernel.apparmor_restrict_unprivileged_userns=0`: Ubuntu 23.10 and later let only AppArmor-profiled programs create one, and the vendored bwrap has no profile.
