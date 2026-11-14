# A2UI 语法：七种统计图的 chart 类型，以及系统资源面板

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `core`, `skills`
- **PR:** [#1225](https://github.com/Prism-Shadow/penguin-harness/pull/1225)

[English](2026-10-19-a2ui-chart-grammar.md)

A2UI 语法新增两种组件块：由数据绘制的基础统计图 `chart`，以及一台机器的系统快照 `resources`。解析器、检查器与纯文本降级都支持这两种类型，`a2ui` Skill 自带的 `check.mjs` 也据此重新构建。

## 组件目录

- `chart`，`kind` 为 `line`、`area`（可堆叠）、`bar`（分组、堆叠或横向）、`pie`（可为环形）、`scatter`、`histogram` 或 `gauge`。各种类共用一套数据模型：类别 × 1–6 个系列，单位标在坐标轴上（`xUnit`、`yUnit`），可写坐标轴名称、数值范围和小数位。直方图用分箱边界代替类别，散点图用 `[x, y]` 点代替数值。仪表的 `item` 是一个指标项，解析与文本输出都与 `metrics` 组件中的完全一致。
- `resources`：一台机器的 CPU（含历史与核数）、内存（含历史）、交换分区、1–6 块磁盘、网络收发速率、负载与运行时间，至少给出一节。着色取自固定阈值而非模型：CPU、内存和交换分区为 80% 和 95%，磁盘为 85% 和 95%，负载为每核 1 和 2。
- 检查器新增代码：`length_mismatch`（错误）；`chart_many_series`、`chart_many_categories`、`pie_many_slices`、`scatter_many_points`（警告）。所选种类用不到的字段报 `ignored_field` 警告并被丢弃。`no_as_of` 也适用于 `resources`；统计图不一定是快照。
- 纯文本形式（CLI、消息渠道）下，统计图在类别或分箱不超过 20 个时每个一条要点，超过时每个系列一行摘要。饼图写出每块的占比，散点图写出每个系列的范围，仪表写出它的指标行。系统资源面板每个读数一条要点。
- 自查清单中关于选用组件与数字的两问涵盖统计图。
- `metrics`、`weather`、`clock` 和 `countdown` 的字段全部保留。
