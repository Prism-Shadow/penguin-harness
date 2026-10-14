# Limit README changes to catalog validation

- **Date:** 2026-10-14
- **Type:** process
- **Scope:** `ci`
- **PR:** [#1136](https://github.com/Prism-Shadow/penguin-harness/pull/1136)

[中文版](2026-10-14-readme-ci-scope.zh.md)

Root README and plugin catalog README changes now select a dedicated Linux catalog check without selecting core or its downstream packages. The check verifies the README tables against the shipped plugin library.

Changes to other files retain their affected-package checks. When core tests are already selected, they include the catalog check and the separate README job is skipped.
