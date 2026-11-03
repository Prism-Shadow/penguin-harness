# 官网新增插件、评估集与榜单页面

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `landing`, `ui`, `docs`, `ui-gallery`, `plugins`, `ci`
- **PR:** [#1430](https://github.com/Prism-Shadow/penguin-harness/pull/1430)

[English](2026-11-02-landing-plugins-benchmarks-leaderboards.md)

penguin.ooo 在「下载」之后新增插件、评估集、榜单三个栏目，每个都是可搜索、可筛选的列表，每个条目有自己的详情页。页面在构建时直接读源文件：插件读本仓库 `plugins/` 下的各个包，评估集与榜单读 [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark) 每次重新浅克隆的副本。本仓库没有另存一份这些数据。

## 细节

- **插件**读各包的 `package.json`（RFC-0003 字段）、`icon.svg`、各 Skill 的 frontmatter 与 README。可按分类、内容（Skills、Hooks、工作台）与作者筛选。插件详情页列出描述、快速开始提示词、Skills、钩子点、工作台、参考文献与包信息。
- **评估集**读 `benchmark_config.toml` 以及每道题的 `task_config.toml` 与题干（RFC-0001）。可按单题时限、是否被榜单收录、状态与作者筛选。详情页逐题折叠展开预算与题干，链接带 `#<task-id>` 时直接展开该题。评分标准留在仓库里，不在官网展示。
- **榜单**按 RFC-0005 计算 RFC-0002 的实验：值为各实验阶段 summary 指标经运算所得，标准差为逐次尝试合成得分的样本标准差，成本、耗时与 Token 为单次运行之和。三种图分别是排行、得分对成本／耗时／Token 的帕累托前沿，以及逐题得分格。评估集仓库尚无 `leaderboards/` 时，由 `packages/landing/hub-placeholder/` 中按同一格式写的榜单代替，引用仓库里真实的 GDPevo-Essential 实验。
- 源文件格式不合规时构建失败。设置 `PENGUIN_BENCHMARK_REPO` 可改读本地检出，不再克隆。
- 官网、文档站与画廊共用的站点导航在「下载」之后列出这三个页面；宽度不足 1024px 时站点链接收进菜单。
- 每个插件的 `package.json` 增加了 `author`；SkillAdam、SkillOpt、TRACE 三个工具包补上 `title`，八个算法工具包补上指向论文的 `penguin.references`。
- Pages 工作流在 `plugins/` 变更时也会部署，并每天定时重建一次，以跟上评估集仓库的更新。
