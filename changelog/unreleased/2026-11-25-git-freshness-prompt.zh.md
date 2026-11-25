# 编程前检查 Git 仓库落后状态并先询问用户

- **Date:** 2026-11-25
- **Type:** feat
- **Scope:** `core`
- **PR:** https://github.com/Prism-Shadow/penguin-harness/pull/1838

[English](2026-11-25-git-freshness-prompt.md)

默认系统提示词的 `# Suggested workflows` 小节新增一条规则：在 Git 仓库中编程前，先检查本地是否落后于远端；若不是最新，先停下来询问用户是否更新到最新提交，再修改代码。

内核版本推进至 `2026-11-25`（`prompt` 标签页）。提示词仍为内置默认值的既有 Agent 可通过内核更新采纳该规则。
