# GDPEVO 自动加载为六个独立领域 Benchmark

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `web`, `ui-gallery`, `landing`, `tooling`
- **PR:** [#1341](https://github.com/Prism-Shadow/penguin-harness/pull/1341)

[English](2026-10-26-gdpevo-domains.md)

新建 Project 通过现有的内置 Benchmark 流程自动获得 GDPEVO-CRM、GDPEVO-ERP、GDPEVO-Finance、GDPEVO-Healthcare、GDPEVO-Legal 和 GDPEVO-DataAnalysis。每个领域复用原来的 Benchmark 和 case 结构，列出五道测试题，省略选填的摘要与资源信息，引用 Benchmark 仓库的 `main` 分支。测试任务采用 `crm-test-001` 这样的领域名称，直接放在 `tasks/` 下，复用原来的用例命名与任务路径处理。题目说明复用原来的 Harbor 启动模板，读取任务的时间限制、不限制轮数，要求传入冻结后的 Agent State，并链接到各领域 README 中的 State 准备和连续训练流程。移除了旧的跨领域 Train/Test 定义和 GDPEVO 固定版本引用。

GDPEVO 初始不带评估记录，训练与测试分别计分。所有内置 Benchmark 的链接与 checkout 说明统一使用 Benchmark 仓库的 `main` 分支，移除了每个 Benchmark 的 `ref` 字段和固定源码 commit。保留了已有 Project 的 Benchmark。通用包导出脚本导出了同样的定义。

六个 GDPEVO 领域保留原始数据集的上游地址和 Apache-2.0 许可证。官网清单在同一来源下列出六个领域 ID，原有一致性测试按选填字段读取上游信息。
