# GDPEVO 自动加载为六个独立领域 Benchmark

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `web`, `ui-gallery`, `tooling`

[English](2026-10-26-gdpevo-domains.md)

新建 Project 通过现有的内置 Benchmark 流程自动获得 GDPEVO-CRM、GDPEVO-ERP、GDPEVO-Finance、GDPEVO-Healthcare、GDPEVO-Legal 和 GDPEVO-DataAnalysis。每个领域包含一个用例，以简短的题干和评分说明引用 Benchmark 仓库的 `main` 分支。移除了旧的跨领域 Train/Test 定义、固定提交和逐题摘要。

GDPEVO 初始不带评估记录，训练与测试分别计分。保留了已有 Project 的 Benchmark，以及 Sec A–E 的内容和校准版本引用。通用包导出脚本导出了同样的六个领域定义。
