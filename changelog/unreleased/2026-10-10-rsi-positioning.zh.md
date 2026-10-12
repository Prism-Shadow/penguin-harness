# PenguinHarness 定位调整为统一、稳定的 Agent 自进化框架

- **Date:** 2026-10-10
- **Type:** process
- **Scope:** `landing`, `docs`, `web`, `tooling`
- **PR:** [#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030)

[English](2026-10-10-rsi-positioning.md)

产品文案从「开源、本地的多 Agent 应用自动开发平台」改为**统一、稳定的 Agent 自进化框架**（Unified and Stable RSI Framework）：全自动优化模型 × Agent Harness。README、官网、文档首页与 Web App 草稿页都先讲 [RSI 工具包](2026-10-10-rsi-toolkits.zh.md)，再讲一句话生成 Agent 应用，最后讲成本。

## 细节

- **README。** 首屏标题、标语与「为什么选择 PenguinHarness」一节重写。三个理由重新排序：最全面的 Agent 自进化框架排在第一，其后是一句话生成 Agent 应用与成本对比，各自保留原有的视频或图表。插件表新增「Agent 自进化」一行。
- **官网。** 首屏写作「统一、稳定的 Agent 自进化框架」，其下是「全自动优化模型 × Agent Harness」，再往下是两张数据卡片（1000+ 模型、100% 开源）与三行清单：支持模型（每个标志链到供应商主页）、自进化算法（Default 不带链接，OPRO、APE、ACE、AWM 链到论文）与评估集（五个内置 Benchmark 只写类别：数据分析、软件工程、业务自动化、科学研究、终端任务，各链到上游仓库）。清单里的外链先弹出确认框，确认后才在新标签页打开。三大特色、RSI 循环与安全两节、案例（「一句话生成 AI 应用，一句话启动自进化」：RAG 文档专家，以及在 `ape-rsi-toolkit` 自带的演示任务上复现 APE）、结尾号召与页脚标语随之更新。雪橇小游戏从官网撤下，图片仍留在仓库里。内置 Skill 一节的「Agent 自进化」卡片收入 `default-rsi-toolkit` 的四个 Skill 与四个算法 Skill。`src/lib/rsi-stats.ts` 持有三份清单，测试把它钉在插件库的 `rsi` 插件、core 的内置 Benchmark 及其上游链接上，并要求 APE 案例的提示词与该工具包的快速开始逐字一致。
- **文档。** 文档首页把 PenguinHarness 介绍为 Unified and Stable RSI Framework，第三根支柱改为讲 RSI 工具包。
- **Web App。** 草稿页改为一屏放得下的启动仪表盘。品牌区保留副标题「最全面的 Agent 自进化平台」，其下三张同样式的指标卡，各以一个大总数领头——本 Project 的智能体数、自进化算法数（插件库 `rsi` 分类的工具包）与本 Project 的评估集数——点总数进入对应列表页；总数之下各有一行弱化的「最近一项」：最近一次 Agent State 变更的智能体及其版本；本浏览器最近选用或启动的工具包，带「开始」按钮（把插件的快速开始填入输入框；所选智能体未安装时为「安装并开始」，先确认再装）与切换其他算法的菜单；最近评测过的 Benchmark 及其最新分数，点击进入该 Benchmark 页。输入框下方是示例文件夹「一句话生成 AI 应用」（默认展开）、「网页与小游戏」、「评测与优化智能体」（含一条导入评测集的示例）与「定时任务」，其后是用户自己的快捷指令——文件夹列于一栏、展开文件夹的条目在旁边一栏，手机上上下堆叠。计数行与「复现自进化算法」文件夹撤下，计数改由指标卡承载，演示改由工具包指标卡承载。
- **包元信息。** 根目录 `package.json` 的描述改为 Unified and Stable RSI Framework。
