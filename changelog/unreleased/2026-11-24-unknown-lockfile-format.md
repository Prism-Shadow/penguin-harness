# Changed lockfiles with unknown formats run full CI

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `ci`
- **PR:** [#1830](https://github.com/Prism-Shadow/penguin-harness/pull/1830)

[中文版](2026-11-24-unknown-lockfile-format.zh.md)

CI now runs the full workspace checks when a changed lockfile uses an unsupported format version.

## Details

Version 9.0 lockfile changes still select the affected packages.
