# Multi-platform offline installer bundles

- **Date:** 2026-07-29
- **Type:** feature
- **Scope:** `tooling`, `ci`
- **PR:** [#131](https://github.com/Prism-Shadow/penguin-harness/pull/131)

[中文版](2026-07-29-offline-install-bundles.zh.md)

- Release builds now wrap each Windows, Linux and macOS platform archive with its checksum and native installer, producing five self-contained offline bundles.
- `install.sh` and `install.ps1` can install a verified local Release archive without network access while preserving their existing online behavior.
- POSIX offline bundles use a dedicated entry point that passes their payload explicitly, so the online installer never trusts archives discovered beside a temporary script.
- Platform packages carry a target manifest, allowing explicit local archive paths to be renamed without relying on the filename for compatibility checks.
- Windows offline bundles include `install.cmd` as a double-click entry point; Linux and macOS bundles keep `install.sh` executable.
