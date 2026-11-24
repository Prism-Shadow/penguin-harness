# Show the time spent thinking and calling tools

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `amsp`, `core`, `web`, `ui-gallery`
- **PR:** [#1823](https://github.com/Prism-Shadow/penguin-harness/pull/1823)

[中文版](2026-11-24-activity-run-finished-label.zh.md)

The conversation activity header shows a tool count from the first call. The clock runs during thinking, tool-argument generation and tool execution. Parallel intervals count once. The time stays fixed through approvals, retries and the final answer. Successful runs show “运行完毕” in Chinese across the three display modes and the interactive demo.

[Existing traces](2026-11-24-backward-compatibility.md)
