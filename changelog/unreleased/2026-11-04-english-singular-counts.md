# English model-group and memory-import dialogs say "1 model" and "1 memory"

- **Date:** 2026-11-04
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1459](https://github.com/Prism-Shadow/penguin-harness/pull/1459)

[中文版](2026-11-04-english-singular-counts.zh.md)

Six English strings printed a count of one in the plural. Deleting a user-defined model group that held one model read "Its 1 models" and then "Group deleted (1 models)". Its speed test asked to test "each of the 1 models". Importing a memory export with one memory read "notes.json — 1 memories", and the confirmation said "1 memories will be overwritten" or "1 memories will be deleted". Each now names one model or one memory in the singular. The Chinese strings were already right and are unchanged.
