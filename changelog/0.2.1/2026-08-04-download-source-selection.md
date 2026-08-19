# Download source selection for standalone installers and `penguin update`

- **Date:** 2026-08-04
- **Type:** feature
- **Scope:** `tooling`, `cli`
- **PR:** [#176](https://github.com/Prism-Shadow/penguin-harness/pull/176), [#196](https://github.com/Prism-Shadow/penguin-harness/pull/196)

[中文版](2026-08-04-download-source-selection.zh.md)

Standalone `install.sh` / `install.ps1` files gain the same OSS-first source selection the `penguin.ooo` forwarding layer got in 0.2.0 (`PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`). Newly published installers are stamped with their immutable Release tag, so a versioned installer downloads exactly its matching package instead of silently following a future latest Release — `auto` tries that tag on OSS first and falls back to the same tag on GitHub, explicit `PENGUIN_DOWNLOAD_BASE_URL` / fallback overrides keep top priority, and offline installation plus unconditional checksum enforcement are unchanged. An unstamped source-tree installer locks a tag through the OSS `latest.json` pointer before downloading anything, and a one-sided stamping state fails the release rather than shipping mismatched POSIX and Windows installers.

`penguin update` now follows the same contract instead of requiring GitHub at the start of every upgrade: release discovery prefers the validated OSS `latest.json` and its immutable release in `auto` (same-tag GitHub fallback; forced `oss` and `github` modes stay strict), the selected payload base and same-tag fallback are handed to the child installer with a stale inherited fallback explicitly cleared, explicit HTTPS mirrors keep precedence, and source-selection failures are reported localized.
