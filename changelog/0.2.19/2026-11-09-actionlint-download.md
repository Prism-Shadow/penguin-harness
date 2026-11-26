# Retry actionlint downloads and use the Release API on failure

- **Date:** 2026-11-09
- **Type:** process
- **Scope:** `ci`
- **PR:** [#1484](https://github.com/Prism-Shadow/penguin-harness/pull/1484)

[中文版](2026-11-09-actionlint-download.zh.md)

Added retries and a GitHub Release API fallback for the actionlint download in CI. The downloaded archive is checked against its pinned SHA-256 before extraction and execution.
