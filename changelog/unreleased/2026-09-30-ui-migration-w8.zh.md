# 统计图与命令面板迁入共享 UI 包

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[English](2026-09-30-ui-migration-w8.md)

UI 包迁移的 W8 把统计图基础与命令面板搬进 `@prismshadow/penguin-ui`。绘制应用数据的统计图留在 Web App，经包内的基元绘制。

## 迁入的内容

- **统计图基元**：各类标记（`ChartBar`、`ChartLine`、`ChartArea`、`ChartPoint`、`ChartArc`、网格与坐标轴、`TimelineBar`）及其几何计算、`useChartStyle`、`ChartFrame` 及其悬停辅助，以及 `TokenDonut`（文案改由 `labels` 属性传入）。
- **新增**：`Sparkline`（智能体活跃度与评估分数两条迷你折线，其所在页面迁移前在 Web App 中保留薄封装）、`Ring`（按预算绘制的圆环仪表，现用于财务仪表与上下文圆环）、`Legend`（行内或列表两种形态，支持悬停、固定与切换）。
- **命令面板**：`CommandPalette` 负责呈现；动作列表与 Ctrl/Cmd+P 快捷键留在 Web App 的 `AppPalette`。

## 细节

- Web App 自有的统计图（成本、Token 与请求图、分数趋势、Trace 时间线、财务卡片）改用 `Legend` 与字号阶梯。
- Trace 时间线上进行中的条不再整条脉动，改为静止并在末端显示一个脉动的实时圆点。
- 画廊的统计图页展示 `Ring` 与 `Legend`，对话框页可打开命令面板。

## 通用主题下可见的变化

- 统计图中 10–11 px 的文字（图例、时间线标签、财务卡片）改为 12 px；图例间距由 16 px 收紧为 12 px。
- 浅色下若干色调墨色深一级（财务圆弧、圆环接近上限的剩余部分、活跃度迷你折线）。
- 上下文面板的内边距略增，图例标签变浅，键盘焦点改用主题的焦点轮廓。
- 命令面板中选中行的底色变浅，未选中行的文字变深。
