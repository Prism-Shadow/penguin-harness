# Faster JSX source checks

- **Date:** 2026-10-14
- **Type:** process
- **Scope:** `web`, `ci`
- **PR:** [#1129](https://github.com/Prism-Shadow/penguin-harness/pull/1129)

[中文版](2026-10-14-source-scan-timeouts.zh.md)

Reduced unnecessary TypeScript parsing in the control-size, disclosure-anchor, notice-icon and required-mark checks. Files without relevant component names or styles are skipped before parsing, while escaped style literals still receive the full JSX check.

Updated the control-size and disclosure fixtures to exercise the same scanners as the repository checks, and added cases for escaped styles, comment-only mentions and footer button sizes.
