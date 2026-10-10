# PenguinHarness 定位调整为大一统、稳定的 RSI 框架

- **Date:** 2026-10-10
- **Type:** process
- **Scope:** `landing`, `docs`, `web`, `tooling`
- **PR:** [#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030)

[English](2026-10-10-rsi-positioning.md)

产品文案从「开源、本地的多 Agent 应用自动开发平台」改为**大一统、稳定的 RSI 框架**（Unified and Stable RSI Framework）：全自动优化模型 × Harness，让任何模型、任何算法、任何 Agent 都能递归自我进化。README、官网、文档首页与 Web App 草稿页都先讲 [RSI 工具包](2026-10-10-rsi-toolkits.zh.md)，再讲一句话生成 Agent 应用，最后讲成本。

## 细节

- **README。** 首屏标题、标语与「为什么选择 PenguinHarness」一节重写。三个理由重新排序：最全面的 Agent 自进化框架排在第一，其后是一句话生成 Agent 应用与成本对比，各自保留原有的视频或图表。插件表新增「Agent 自进化」一行。
- **官网。** 首屏写作「大一统、稳定的 RSI 框架」（「RSI」与「Agent 自进化」轮换），下方是「全自动优化模型 × Harness · 任何模型 · 任何算法 · 任何 Agent」。数据卡片改为 1000+ 模型、自进化算法数、Benchmark 复现数与 100% 开源；两个数字取自 `src/lib/rsi-stats.ts`，测试把它钉在插件库的 `rsi` 插件与 core 的内置 Benchmark 上。三大特色、RSI 循环一节、结尾号召与页脚标语随之更新。案例一节改为两个一句话示例：生成 AI 应用（RAG 文档专家），以及在 `rsi-ape` 自带的演示任务上复现 APE，后者暂以评估中心的截图作为占位图。雪橇小游戏从官网撤下，图片仍留在仓库里。内置 Skill 一节新增「Agent 自进化」卡片，收入 `rsi-default` 的四个 Skill 与四个算法 Skill。
- **文档。** 文档首页把 PenguinHarness 介绍为大一统、稳定的 RSI 框架，第三根支柱改为讲 RSI 工具包。
- **Web App。** 草稿页的副标题改为「最全面的 Agent 自进化平台」，下面一行显示取自 `GET /api/rsi` 的自进化算法数与 Benchmark 复现数，两个数字分别链接到插件库与评估中心。示例文件夹默认展开「复现自进化算法」：在各自的演示任务上复现 APE 与 OPRO，以及 Default RSI Toolkit 的决策智能体示例。
- **包元信息。** 根目录 `package.json` 的描述改为 Unified and Stable RSI Framework。
