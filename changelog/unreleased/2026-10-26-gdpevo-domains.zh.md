# GDPEVO 六个领域分别内置 Train/Test

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `web`, `ui-gallery`, `landing`, `tooling`, `agent-evaluation`
- **PR:** [#1341](https://github.com/Prism-Shadow/penguin-harness/pull/1341)

[English](2026-10-26-gdpevo-domains.md)

新建 Project 为 GDPEVO-CRM、GDPEVO-ERP、GDPEVO-Finance、GDPEVO-Healthcare、GDPEVO-Legal 和 GDPEVO-DataAnalysis 六个领域分别内置 Train 和 Test Benchmark。每个 Train 包含一个连续训练 Case，五道训练题在同一 Agent Session 和业务容器内完成，整组解题限时 6 小时，最后导出 Skill。每个 Test 包含五个独立 Cases，每题解题限时 4 小时。两者均不限制轮数。测试前冻结导出的 Skill，Train/Test 分别计分。

十二个 GDPEVO 条目复用现有 Benchmark 结构、初始化流程、Harbor 启动模板和包导出脚本。测试任务以 `crm-test-001` 等领域名称直接放在 `tasks/` 下；训练选择同一目录下的 `train_tasks`。中英文介绍说明各领域及训练、测试的区别。示例页、官网清单和导入示例使用对应的 Train/Test ID。保留已有 Project 的 Benchmark，新建的 GDPEVO 条目不带评估记录。

所有内置 Case 定义删除 `summary`、`category`、`cpus` 和 `memoryMb`，同时删除对应的说明生成分支。Case 说明保留任务标题、来源链接、网络和评分器信息，以及启动和评分方式。Docker 资源限制仍由 Benchmark 仓库的任务文件管理。Benchmark 顶层字段除删除 `ref` 外，保持原来的必填或选填状态；来源链接与 checkout 说明使用 Benchmark 仓库的 `main` 分支。Agent Evaluation 接受分支、标签及提交链接，每轮评测开始时解析一次来源版本，所有评测任务共用同一份检出。
