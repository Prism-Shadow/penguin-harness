# 侧栏拆为框架、会话列表模块与项目模块

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`

[English](2026-10-03-web-sidebar-split.md)

Web App 中 3140 行的 `sidebar.tsx` 与 1100 行的 `project-dialogs.tsx` 按职责拆开。同样的组件以同样的状态渲染同样的 DOM，只动了文件与目录。

- `web-app/sidebar/`：`sidebar.tsx` 只留框架（模式开关、切换器、固定的「新对话」、页面导航、会话列表或公司分区、账户行）；`rail.tsx` 是从 `app-layout.tsx` 搬出的折叠窄栏；`page-nav.tsx` 是页面导航行（含插件贡献的公司模式页面）、拖拽与折叠/固定状态。`nav-state.ts`（原 `lib/nav-group-collapse.ts`）、`user-menu.tsx`、`router-link.tsx` 搬入；`app-layout.tsx` 搬到 `shell/`。
- `features/session-list/`：会话列表——头部、草稿组、按 Agent / Workspace / 时间三种分组、分组主体、会话行与菜单、对话框。状态按职责拆为若干 hook，由 `useSessionList` 组合；侧栏调用这个 controller，列表状态的生命周期与侧栏一致，和原来相同。`lib/pinned-sessions.ts` 与 `lib/group-order.ts` 随之搬入；其余 `lib/session-*.ts` 另有使用者，留在原处。
- `features/projects/`：`ProjectSwitcher` 与项目对话框，设置页每页一个文件（常规、成员、对话默认值、安全策略）。
- `NEW_CHAT_ICON` 移到 `lib/nav-icons.ts`。边界基线从 230 行变为 239 行：库→feature 40 → 28，feature→feature 147 → 168，环保持 43。
- 用户可见的行为没有变化。
