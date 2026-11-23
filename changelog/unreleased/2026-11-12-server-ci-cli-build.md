# Server CI builds the CLI without duplicating its tests

- **Date:** 2026-11-12
- **Type:** fix
- **Scope:** `ci`
- **PR:** [#1484](https://github.com/Prism-Shadow/penguin-harness/pull/1484)

[中文版](2026-11-12-server-ci-cli-build.zh.md)

Separated the CLI build required by server tests from the packages selected for those tests.

## Details

- Kept CLI builds in server test jobs on Linux, macOS and Windows.
- Kept the CLI suite in its existing test jobs and prevented CLI-only edits from creating server test jobs.
- Added regression coverage for build inputs and test placement.
