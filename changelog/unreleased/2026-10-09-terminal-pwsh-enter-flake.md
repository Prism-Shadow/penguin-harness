# The terminal PATH test resends a lost Enter to pwsh on macOS

- **Date:** 2026-10-09
- **Type:** test
- **Scope:** `server`
- **PR:** [#1005](https://github.com/Prism-Shadow/penguin-harness/pull/1005)

[中文版](2026-10-09-terminal-pwsh-enter-flake.zh.md)

`test/terminal-path-first.test.ts` failed now and then on macOS CI: pwsh printed its prompt before PSReadLine took the terminal, so the typed command line reached its buffer without the Enter that came with it, and the test waited out its deadline. The test now sends one more Enter when the expected output has not appeared after five seconds.
