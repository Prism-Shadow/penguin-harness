# PenguinHarness 定位调整为统一、稳定的 Agent 自进化框架

- **Date:** 2026-10-10
- **Type:** process
- **Scope:** `landing`, `docs`, `web`, `tooling`
- **PR:** [#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030)

[English](2026-10-10-rsi-positioning.md)

产品文案从「开源、本地的多 Agent 应用自动开发平台」改为**统一、稳定的 Agent 自进化框架**（Unified and Stable RSI Framework）：全自动优化模型 × Agent Harness。README、官网、文档首页与 Web App 草稿页都先讲 [RSI 工具包](2026-10-10-rsi-toolkits.zh.md)，再讲一句话生成 Agent 应用，最后讲成本。

## 细节

- **README。** 首屏标题、标语与「为什么选择 PenguinHarness」一节重写。三个理由重新排序：最全面的 Agent 自进化框架排在第一，其后是一句话生成 Agent 应用与成本对比，各自保留原有的视频或图表。插件表新增「Agent 自进化」一行。
- **官网。** 首屏写作「统一、稳定的 Agent 自进化框架」，其下是「全自动优化模型 × Agent Harness」，再往下是两张数据卡片（1000+ 模型、100% 开源）与三行清单：支持模型（每个标志链到供应商主页）、自进化算法（Default 链到文档，OPRO、APE、ACE、AWM 链到论文）与 Benchmark 复现（Sec A–E 各标类别，链到上游仓库）。清单里的外链先弹出确认框，确认后才在新标签页打开。三大特色、RSI 循环与安全两节、案例（「一句话生成 AI 应用，一句话启动自进化」：RAG 文档专家，以及在 `ape-rsi-toolkit` 自带的演示任务上复现 APE）、结尾号召与页脚标语随之更新。雪橇小游戏从官网撤下，图片仍留在仓库里。内置 Skill 一节的「Agent 自进化」卡片收入 `default-rsi-toolkit` 的四个 Skill 与四个算法 Skill。`src/lib/rsi-stats.ts` 持有三份清单，测试把它钉在插件库的 `rsi` 插件、core 的内置 Benchmark 及其上游链接上，并要求 APE 案例的提示词与该工具包的快速开始逐字一致。
- **文档。** 文档首页把 PenguinHarness 介绍为 Unified and Stable RSI Framework，第三根支柱改为讲 RSI 工具包。
- **Web App。** 草稿页改为启动仪表盘。品牌区保留副标题「最全面的 Agent 自进化平台」，新增四张数据卡片：`GET /api/rsi` 统计的自进化算法数与 Benchmark 复现数、本 Project 的智能体数，以及各 Benchmark 累计的评估记录数。输入框下方依次是：每个 RSI 工具包一张卡片（名称、一句说明、所选智能体是否已安装；「开始」把插件的快速开始填入输入框，未安装时为「安装并开始」）、本 Project 的 Benchmark 与各自最近一条评估，以及示例文件夹「一句话生成 AI 应用」（默认展开）、「网页与小游戏」、「评测与优化智能体」（含一条导入评测集的示例）与「定时任务」，其后是用户自己的快捷指令。计数行与「复现自进化算法」文件夹撤下，计数改由数据卡片承载，演示改由工具包卡片承载。
- **包元信息。** 根目录 `package.json` 的描述改为 Unified and Stable RSI Framework。
