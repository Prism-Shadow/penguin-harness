# Separate optimization contracts from method references

- **Date:** 2026-10-03
- **Type:** process
- **Scope:** `skills`, `docs`

[中文版](2026-10-03-rsi-methods.zh.md)

Made `agent-optimization` the general input, evaluation, versioning and output
contract. Moved Penguin's default optimization policy into a reference and added
ACE and AWM as method references with their own feedback and acceptance rules.

## Details

- Kept Penguin as the default when no method is specified, including its strict
  improvement gate and baseline sampling policy.
- Retained ACE's incremental rule updates and AWM's induction from successful
  experiences, with frozen Student batches and independent testing.
- Used Agent Tuning's existing plugin and file loader; added no method packages,
  package dependencies or core/CLI implementation changes.
