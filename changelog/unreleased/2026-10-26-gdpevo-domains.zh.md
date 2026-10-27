# GDPEVO 六个领域分别内置 Train/Test

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `web`, `ui-gallery`, `landing`, `tooling`, `agent-evaluation`
- **PR:** [#1341](https://github.com/Prism-Shadow/penguin-harness/pull/1341)

[English](2026-10-26-gdpevo-domains.md)

新建 Project 为 GDPEVO-CRM、GDPEVO-ERP、GDPEVO-Finance、GDPEVO-Healthcare、GDPEVO-Legal 和 GDPEVO-DataAnalysis 六个领域分别内置 Train 和 Test Benchmark。每个 Train 包含一个连续训练 Case，五道训练题在同一 Agent Session 和业务容器内完成，整组解题限时 6 小时，最后导出 Skill。每个 Test 包含五个独立 Cases，每题解题限时 4 小时。两者均不限制轮数。测试前冻结导出的 Skill，Train/Test 分别计分。

十二个 GDPEVO 条目复用现有 Benchmark 包格式和初始化流程。测试任务以 `crm-test-001` 等领域名称直接放在 `tasks/` 下；训练选择同一目录下的 `train_tasks`。中英文介绍说明各领域及训练、测试的区别。示例页、官网清单和导入示例使用对应的 Train/Test ID。保留已有 Project 的 Benchmark，新建的 GDPEVO 条目不带评估记录。

内置内容统一在 Benchmark 仓库的 `packages/` 维护。构建时从 `main` 获取清单和每个 Case 的两份 Markdown，放入 npm 包、桌面安装包和离线发布包。源码构建会在本地缓存这些包；`node scripts/build-benchmarks.mjs --refresh` 用于刷新，`PENGUIN_BENCHMARKS_SOURCE` 用于在两个仓库联调时指定本地包目录。程序启动和创建 Project 时都不联网获取 Benchmark。

Harness 原样复制包的清单与 Case 文件，并创建空的评分记录。删除写死数据的 `builtin-benchmarks-data.ts`、题干和评分说明生成器，以及反向导出包的脚本；示例页使用同一批文件生成的展示数据。Case 说明不再重复 `summary`、`category`、`cpus` 和 `memoryMb`，Docker 资源限制仍由任务文件管理。来源链接使用 `main`，不再给每个 Benchmark 配置 `ref`。Agent Evaluation 接受分支、标签及提交链接，每轮评测开始时解析一次来源版本，所有评测任务共用同一份检出。
