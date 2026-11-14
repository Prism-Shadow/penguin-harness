# Desktop dry runs sign nothing unless signing is required

- **Date:** 2026-10-22
- **Type:** process
- **Scope:** `ci`, `desktop`
- **PR:** [#1296](https://github.com/Prism-Shadow/penguin-harness/pull/1296)

[中文版](2026-10-22-unsigned-dry-run.zh.md)

`desktop-build.yml` handed the EVSign key to the Windows build, and downloaded the EVSign
client, only when Windows signing was required: in a release, on a push to a `release/**`
branch, or in a dispatch with `require_windows_signing=true`. A dispatch without it built
unsigned Windows installers even though the `desktop-build` environment held the key, as macOS
and Linux already did; until then such a dry run had EV-signed every Windows build.

Each build job wrote whether its artifacts were signed to the run summary. The Windows artifact
gate kept running on dry runs: it accepted unsigned files, still checked the update metadata
against the final installer bytes and still failed a broken signature. A build that required
signing still failed on a missing key or an invalid signature.
