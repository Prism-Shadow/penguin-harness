# 文件摘要等待 Task 结束

- **Date:** 2026-07-30
- **Type:** fix
- **Scope:** `web`
- **PR:** [#143](https://github.com/Prism-Shadow/penguin-harness/pull/143)

[English](2026-07-30-file-summary-task-boundary.md)

主对话的文件摘要不再在工具与后续模型轮次仍在运行时、于某条中间助手消息之后出现。它现在只在 Task 完成的边界处出现一次，并扫描该 Task 中的全部助手文本，因此在工具调用之前提到的路径在最终摘要中仍然可用。嵌套的 Agent 对话保留其既有的逐消息摘要，因为它们内嵌的流不暴露父视图的 Task 页脚。文件存在性缓存也不再保留否定结果，使后续 Task 得以创建并呈现一个此前并不存在的路径。存在性检查按服务端可接受的批量大小发出，因此一个引用路径数超过单次 files/stat 调用上限的长 Task 仍能拿到它的摘要，而不是无声地丢掉。
