# Chat toolbar actions stay clear of live statistics

- **Date:** 2026-08-03
- **Type:** fix
- **Scope:** `web`
- **PR:** [#151](https://github.com/Prism-Shadow/penguin-harness/pull/151)
- **Issue:** [#150](https://github.com/Prism-Shadow/penguin-harness/issues/150)

[中文版](2026-08-03-chat-toolbar-layout.zh.md)

At medium desktop widths, the pinned sidebar leaves the chat toolbar substantially narrower than the viewport breakpoint suggests. The Agents panel and Workspace actions now remain icon-only until the large-screen breakpoint, preserving space between the running indicator and the live Token, cost, and elapsed-time statistics; their labels return on wider screens, while titles and accessible names keep the compact buttons identifiable. A browser regression test reproduces the approximately 2:1 viewport from issue [#150](https://github.com/Prism-Shadow/penguin-harness/issues/150) and verifies that the running status and Token total never intersect.
