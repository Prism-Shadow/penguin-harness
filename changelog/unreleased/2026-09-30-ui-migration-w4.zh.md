# 布局、导航、提示与数据迁入共享 UI 包

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[English](2026-09-30-ui-migration-w4.md)

UI 包迁移的 W4 把 Web App 的页面结构搬进 `@prismshadow/penguin-ui`，并让各页改用它们：页头、卡片、表格、分节、提示、进度与统计。

## 迁入的内容

- **迁入**：`Tabs`、分组列表（`GroupHeader`、`FolderSection`、`MoreRow`，以及新增的 `Pager`）、`CreateButtons`、`TodoNotice`、`BetaBadge`、`DisclosureRow`、`LiveDuration` 与 `StatTile`。
- **新增布局**：`PageFrame` 与 `PageHeader`、`Card` 与 `CardHeader`、`RuledSection`、`CollapsibleSection`、`EntityHeader`。
- **新增数据**：`Table` 系列、`KeyValue`、`ListRow`、`LogView`、`StatChip`。
- **新增提示与导航**：`Notice`（建在提示条上的 strip、callout、inline 三种形态，可带关闭、重试与操作）、`ProgressBar`、`DurationSlot`，以及 `NavList` / `NavRow`——设置对话框与项目设置的侧栏已改用它们。

## 细节

- 智能体、智能体设置、模型、插件、评估中心、Trace、机器与定时任务各页，以及公司模式的全部页面改用这些组件，其去 AI 味白名单条目随之清空。
- 各主题下的页面标题字号保持不变。
- 不定进度条（更新对话框的安装阶段）作为实时信号脉动，由各主题自定节奏。
- 包自带的无障碍兜底文案新增展开 / 收起、更多 / 更少、上一页 / 下一页与页码位置。
- 画廊新增「布局」与「数据」两页，「提示条」「加载」「徽章」各页展示新组件。

## 通用主题下可见的变化

- 这些页面中多数 10–11 px 的说明、计数、标签与元信息改为 12 px，2 px 的间距改为 4 px。
- 表格统一表头：字重由粗体改为中等，高度减 4 px，下方加分隔线，行带悬停底色，末行不再有分隔线。
- 页头的操作与标题相距 16 px，窄屏换行时靠右对齐。
- 可折叠分组（记忆、插件）带边框外框，标题行不再有悬停底色，展开箭头位于操作之前。
- 对话中工作组的标题不再全大写。
- 侧栏：未选中项的文字浅一级；项目设置的图标为 16 px，取次要墨色。
- 财务表格、日历与工单卡片改用 12 px 字阶与令牌线色，内边距略增。
- 评估用例浏览器的目录树加宽（英文 380 px、中文 270 px），以放下文件夹名。
