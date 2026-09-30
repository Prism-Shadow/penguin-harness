# 对话记录与输入区迁入共享 UI 包

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[English](2026-09-30-ui-migration-w6.md)

UI 包迁移的 W6 把对话拆分进 `@prismshadow/penguin-ui`：对话记录与输入区的呈现由包负责，Session 状态、发送与模型目录留在 Web App。

## 迁入的内容

- **对话记录**：
  - `MessageBubble`、`MessageMeta`、`MessageImage`。
  - 流式回答 `AssistantText` 与 `StreamingCaret`，流式显现的节奏随之迁入。
  - `ChangesCard`，现同时用于消息文件卡与记忆变更卡。
- **Agent 的工作过程**：`WorkGroup`、`ThinkingBlock`、`StepBanner`、`ToolCallCard`、`ApprovalButtons` 与 `ApprovalBlock`、`SubagentChip`；Web App 为每个组件保留一个很薄的 Session 容器。
- **输入区**：
  - `ComposerCard`、`ChipRow`、`ToolbarTrigger`、`SendButton`、`SlashMenu`、`SlashPicker`。
  - `TagInput` 与 `Chip`，以及输入区的选择框 `MenuSelect`。
  - `ContextRing`，以及模型选择器的触发按钮 `ModelSelect`（选择器本身是 Web App 的模型选择对话框）；Web App 中绑定模型目录的选择器改名为 `ModelCatalogSelect`。
- **公司频道**：`ChannelRun` 与 `ChannelBubble`。

## 细节

- 新增令牌 `--ui-fill-neutral`：消息气泡与标签片所用的中性填充。各主题取改动前的气泡灰，因此 Console 的气泡仍有底色。
- 输入区在各主题下保留原有的中性焦点环。
- Trace 与对话中工具行的占位不再脉动；停止按钮改为中性底加红色图标。

## 通用主题下可见的变化

- **文字与墨色**：
  - 对话与输入区的墨色在浅色下深一级（gray-800 → gray-900），深色下浅一级。
  - 10–11 px 的说明改为 12 px：消息时间、统计行、子 Agent 编号、附件大小。
- **步骤横幅**：标题改为 12 px 的句首大写，不再是 11 px 全大写。
- **输入区**：
  - 发送按钮取强调色填充。
  - 停止按钮由红色浅底改为中性底加红色图标。
  - 工具栏按钮的悬停底色变浅。
  - 引用标签片与其他标签片同为 24 px 高。
- **对话页头**：Session 标题为 14 px，取最接近的标题字阶（原 15 px）。
- **公司频道**：自己的气泡改为链接色的浅色晕染，名字与时间为 12 px。
