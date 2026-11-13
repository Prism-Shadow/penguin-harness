# Keep embedded fences inside step code examples

- **Date:** 2026-11-13
- **Type:** fix
- **Scope:** `a2ui`

[中文版](2026-11-13-a2ui-step-code-fences.zh.md)

The text fallback for A2UI steps chose a backtick fence longer than any run in the code snippet. Markdown examples containing their own fences stayed inside the step's code block instead of closing it early.
