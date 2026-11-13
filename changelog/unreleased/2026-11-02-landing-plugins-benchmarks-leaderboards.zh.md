# 官网新增插件、评估集与榜单页面

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `landing`, `ui`, `docs`, `ui-gallery`, `plugins`, `ci`
- **PR:** [#1430](https://github.com/Prism-Shadow/penguin-harness/pull/1430)

[English](2026-11-02-landing-plugins-benchmarks-leaderboards.md)

penguin.ooo 在「下载」之后新增插件、评估集、榜单三个栏目，每个都是可搜索、可筛选的列表，每个条目有自己的详情页。页面在构建时直接读源文件：插件读本仓库 `plugins/` 下的各个包，评估集与榜单读 [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark) 每次重新浅克隆的副本。本仓库没有另存一份这些数据。

## 细节

- 列表页的搜索框与排序方式和标题并排，分面筛选在侧栏，卡片一行两张：带底色的图标块（每个插件分类、每个评估集系列各有颜色）、标题，以及作者与几项要点。详情页顶部是图标块、标题、标签与 GitHub 链接，正文分块放在带标题栏的面板里、打开时依次浮现，要点在侧栏，参考文献放在最后。
- **插件**读各包的 `package.json`（RFC-0003 字段）、`icon.svg`、各 Skill 的 frontmatter 与 README。可按分类、内容（Skills、Hooks、工作台）与作者筛选。插件详情页列出描述、快速开始提示词、Skills、钩子点与工作台，以及 README。
- **评估集**读 `benchmark_config.toml` 以及每道题的 `task_config.toml`、题干与评分标准（RFC-0001）。可按单题时限、是否被榜单收录、状态与作者筛选。每道题展开后显示预算和三个标签页：题干、评分标准，以及题目在 `data/` 下有目录时的数据（Agent 收到的指令与目录里的文件）。链接带 `#<task-id>` 时直接展开该题。「数据」面板展示该评估集 `data/` 目录的 README。克隆时 `data/` 只下载各 README 与指令文件，文件列表取自 git。
- **榜单**每个读一份 `leaderboard.yaml`（RFC-0005），计算 RFC-0002 的实验：值为各实验阶段 summary 指标经运算所得；标准差为逐次尝试合成得分的样本标准差，尝试次数对不齐时改由各实验的 `score_std` 合成；成本、耗时与 Token 为单次运行之和。结果面板占满页面宽度，要点与评估集放在下方。工具栏切换视图，并有「筛选」菜单（模型、Harness、算法、思考等级，只在条目之间有差异时出现）以及排行视图的「列」菜单。排行表列出排名（前三名带底色）、模型与思考等级、Harness、算法、带误差棒的得分、发布时间与成本：点表头排序，单元格不换行、超出部分省略并在悬停时显示全文，点开得分可看该条目的原始数据（各实验的 summary 与 Harness 设置）。条目按榜单比较的那一项命名（算法，其次 Harness，再次模型），并在排行、得分对成本／耗时／Token 的帕累托图与逐题得分格中保持同一颜色；逐题得分格横向为方法，纵向为题目，题目链到所属评估集。「计算方式与来源」面板用真实数值展示计算过程：每个评估集上各条目对应实验的值，以及合成的得分、标准差、成本与耗时之和，并链接 `leaderboard.yaml` 与实验目录。
- 只显示已发布的评估集与榜单，`draft` 状态的不显示。
- 源文件格式不合规时构建失败。设置 `PENGUIN_BENCHMARK_REPO` 可改读本地检出，不再克隆。
- 官网、文档站与画廊共用的站点导航在「下载」之后列出这三个页面；宽度不足 1024px 时站点链接收进菜单。
- 每个插件的 `package.json` 增加了 `author`；SkillAdam、SkillOpt、TRACE 三个工具包补上 `title`，八个算法工具包补上指向论文的 `penguin.references`。
- Pages 工作流在 `plugins/` 变更时也会部署，并每天定时重建一次，以跟上评估集仓库的更新。
