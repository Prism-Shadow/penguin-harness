# 评估中心：每次运行都能打开它的 Session；题目多时分页

- **Date:** 2026-10-12
- **Type:** improvement
- **Scope:** `web`
- **PR:** [#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030)

[English](2026-10-12-evaluation-run-links.md)

评估中心的评估详情弹窗去掉了 Session 列：每道题下的**运行 #N** 改为指向该次运行所在 Session 的链接。Session 已归档（因而不在侧栏里）时改为弹出提示框，写明它的标题与 ID（ID 带复制按钮），请到**设置 › 已归档对话**里找，并带一个直接打开该页的按钮。记作 Harbor trial 的运行保持纯文字，旁边仍是复制 trial 名的按钮。弹窗里的题目名不再链到题目详情。

Benchmark 页面的题目列表每题只占一行，名称过长时截断、完整名称在 tooltip 里；题目超过十个时分页，每页十个，列表上方有翻页控件。
