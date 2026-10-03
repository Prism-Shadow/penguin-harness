# 会话页拆成控制器、工具栏、正文与面板

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`

[English](2026-10-03-web-chat-split.md)

Web App 的会话页原是一个 2800 行的组件，现按职责拆开；Workspace 浏览器与模型选择器搬出 chat 模块。

- `features/workspace/`（Files 面板的浏览器、Workspace 选择器与查找器、树视图、回复中文件链接的 provider）与 `features/model-picker/`（模型目录选择、其对话框与逻辑、思考级别词表）各自成为模块，带 `index.ts`；草稿页搬进 `features/chat/body/`。回形针图标移到 `lib/attachments.ts`。
- `chat-page.tsx` 只负责组合（不到 200 行）：`session/use-chat-session.ts` 是控制器，由若干段连续的子 hook 组成，按原组件的顺序调用；`toolbar/` 放工具栏、详情卡片、进程列表与头部统计；`body/` 放正文与输入框；`session/session-dialogs.tsx` 放三个对话框；`panels/render-panel.tsx` 放停靠面板的内容，仍是按 `PanelKind` 分派的一个 `renderPanel`。
- `DRAFT_SESSION_ID` 移到 `draft-sessions.ts`。其他 feature 只经 `features/chat/index.ts` 使用 chat（新会话草稿的路由与缓存、Skill 文本函数、消息流跟随、面板宽度）。`pickDefaultAgent` 移到 `lib/default-agent.ts`，chat 不再 import ai-create。
- 边界基线由 156 行降到 141 行：feature→feature 122 → 101，环 34 → 40（两个新模块落在它们的文件在 chat 内时所在的环上）。
- 用户可见行为不变。
