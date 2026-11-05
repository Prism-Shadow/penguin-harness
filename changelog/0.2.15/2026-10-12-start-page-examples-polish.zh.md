# 首页：示例标题更清楚，两个小游戏提示词重写，各块之间留出更多空间

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1067](https://github.com/Prism-Shadow/penguin-harness/pull/1067)

[English](2026-10-12-start-page-examples-polish.md)

首页的示例标题更直白，两个小游戏示例改为生成不同的游戏，页面各块之间的距离也拉开了一些。

## 细节

- **标题。** 「Default 优化：提升决策智能体的准确率」改为「优化决策智能体」；「导入评测集：看看仓库里有哪些
  Benchmark 包」改为「导入 GDPevo 评测集」；「法务智能体：上传文件，下载分析报告」改为「一句话构建法务智能体应用」；
  英文的 "Build a general-purpose decision agent and its benchmark" 改为 "Build a decision agent and its
  benchmark"，一行放得下。
- **法务智能体示例。** 提示词把 Workflow 标签页做在新建的法务智能体上，这才是示例的本意，而不是做在构建它的智能体自己身上。
- **导入示例。** 改为经 `benchmark-design` 从 Prism-Shadow/penguin-harness-benchmark 的
  `packages/penguinharness-benchmark-gdpevo-train` 导入 GDPevo，配对的测试集一并导入；Project 里已经有了就保持原样。
- **节奏跑酷。** 企鹅随音符所在的路线变换形态：接上方音符时飞起来，接下方音符时趴上雪橇贴地滑行。提示词要求难度
  尽量简单（音符稀疏、判定宽松、漏接不会直接结束），并建议用纯音乐。
- **滑雪小游戏。** 企鹅雪橇越野改为滑雪大冒险式的玩法：雪山起伏有高度，冲过坡顶腾空，在空中翻滚、落地摆正得分。
- **间距。** 品牌行、输入卡片与示例之间留出更多空间，示例与分类行加高。侧栏展开时，页面在 1280×800 与 1440×900
  下仍一屏放得下。
