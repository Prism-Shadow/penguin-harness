# The ubuntu CI shards run the plugin suites, and a sandbox live suite CI requires cannot skip

- **Date:** 2026-09-28
- **Type:** process
- **Scope:** `ci`, `plugins/sandbox-bwrap`, `plugins/sandbox-dsh`, `plugins/sandbox-seatbelt`
- **PR:** [#872](https://github.com/Prism-Shadow/penguin-harness/pull/872)

[中文版](2026-09-28-ci-ubuntu-runs-plugin-suites.zh.md)

The ubuntu `rest` test shard named its packages explicitly, so no package under `plugins/` ran its tests on Linux, while macOS and Windows ran them all. The Linux sandbox backends' live suites (`sandbox-bwrap`, `sandbox-dsh`), which skip everywhere but Linux, therefore ran nowhere.

## Details

- The ubuntu `rest` shard is now recursive with exclusions, like macOS and Windows: everything except core, server, web, ui and cli (which have shards of their own). A new package is scheduled by default instead of by remembering to list it. Its build list is the one macOS and Windows use.
- `PENGUIN_MUST_RUN` (comma-separated suite directory names under `plugins/`: `sandbox-bwrap`, `sandbox-dsh`, `sandbox-seatbelt`) names the environment-dependent suites a run requires. A named suite whose host probe fails now fails with the probe's reason instead of skipping; an unnamed one skips where it cannot open, as before, and so does a misspelled name. The three live suites share the check, `scripts/must-run.mjs`. CI sets it on the `rest` shard: ubuntu `sandbox-bwrap,sandbox-dsh`, macOS `sandbox-seatbelt,sandbox-dsh`.
- `sandbox-bwrap`'s tests put the bubblewrap the plugin ships in place: on Linux, a vitest global setup calls `scripts/vendor-bwrap.mjs` (pinned by sha256, cached under `node_modules/.cache`). A test run alone now measures the binary users get, and CI no longer builds the plugin for it. The vendorer now treats its output as in place only when every architecture's `bwrap` is present and executable, not on the marker alone, so the build repairs a damaged vendor directory too.
- A step before the tests on that shard, "Allow unprivileged user namespaces", sets `kernel.apparmor_restrict_unprivileged_userns=0`: Ubuntu 23.10 and later let only AppArmor-profiled programs create one, and the vendored bwrap has no profile.
