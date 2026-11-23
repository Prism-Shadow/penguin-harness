# Reduce setup time for CI planning and Windows installer tests

- **Date:** 2026-11-23
- **Type:** process
- **Scope:** `ci`

[中文版](2026-11-23-ci-build-selection.zh.md)

The CI planner passes build exclusions directly to pnpm. Windows installer tests run from a clean checkout using the ZIP archives the PowerShell suite creates.
