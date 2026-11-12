# 压缩端到端用例跟上对话页与 Trace 视图的现状

- **Date:** 2026-11-12
- **Type:** process
- **Scope:** `web`

[English](2026-11-12-compaction-e2e-context-ring.md)

更新 Web 端到端用例「compaction mid-turn」中三处过期的断言，使其重新通过，原先首个失败点之后的检查也恢复运行。

## 细节

- 压缩完成后，按角色与可访问名称读取输入框的上下文圆环，不再等待圆环自 [#442](https://github.com/Prism-Shadow/penguin-harness/pull/442) 起就不再显示的 `—/240` 数字。
- 先展开压缩行的「压缩结果」小节再查找摘要，与 [#582](https://github.com/Prism-Shadow/penguin-harness/pull/582) 引入的两层压缩行一致。
- 从各轮自己的行读取 Trace 轮次编号，因为 [#1305](https://github.com/Prism-Shadow/penguin-harness/pull/1305) 的轮次按钮也会显示当前可见的轮次。
