# 停靠面板与 workflow 标签条改为槽位贡献

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`

[English](2026-10-03-web-chat-slots.md)

会话页不再点名停靠区的面板和旁边的 workflow 标签，改由各自所属的模块贡献。

- dock 模块声明 `DockModule.panels`（`features/dock/iface.ts`）：面板 kind 的名称、图标与菜单次序是数据，面板内容是代码半。chat 贡献 agents 与 memory 面板，新增的 `WorkspaceModule`、`TracesModule` 贡献 Files 与 Trace 面板，messaging、schedules、内置浏览器各自贡献自己的面板。`panels/render-panel.tsx`、`features/dock/panel-meta.tsx` 以及只被它们使用的五个词条删除。
- 面板经 `useChatSession()`（`lib/chat-session.ts`）读所停靠的会话，草稿态的占位由面板自己给出（`lib/dock-panel-empty.tsx`）。会话页的控制器 hook 改名为 `useChatController()`（`session/use-chat-controller.ts`）。
- `PanelKind` 改为字符串。已存的停靠布局格式不变；读到无模块贡献的 kind 时丢弃该标签，同一停靠区的其余标签保留。
- chat 模块声明 `ChatModule.sessionTabs`，workflows 贡献标签条及其页面框。
- 共用的侧栏面板宽度从 chat 搬到 dock，dock 不再 import chat；chat 不再 import traces、messaging、workflows。
- 边界基线从 141 行降到 121 行：feature→feature 101 → 92，环 40 → 29。
- 用户可见的界面没有变化。
