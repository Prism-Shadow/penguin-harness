# The sidebar splits into a frame, a session list module and a projects module

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`

[中文版](2026-10-03-web-sidebar-split.zh.md)

The Web App's 3,140-line `sidebar.tsx` and 1,100-line `project-dialogs.tsx` are split by what each part does. The same components render the same DOM with the same state; only files and directories changed.

- `web-app/sidebar/`: `sidebar.tsx` keeps the frame (mode switch, switcher, the pinned New chat, page nav, list or company sections, account row); `rail.tsx` holds the collapsed rail, moved out of `app-layout.tsx`; `page-nav.tsx` holds the page rows (including the company-mode pages plugins contribute), their drag and the fold/pin state. `nav-state.ts` (was `lib/nav-group-collapse.ts`), `user-menu.tsx` and `router-link.tsx` moved in; `app-layout.tsx` moved to `shell/`.
- `features/session-list/`: the conversation list — header, parked drafts, the by-Agent / by-Workspace / by-time groupings, the group body, the row and its menu, the dialogs. Its state is split by concern into hooks composed by `useSessionList`; the sidebar calls that controller, so the list's state lives as long as the sidebar, as before. `lib/pinned-sessions.ts` and `lib/group-order.ts` moved in; the other `lib/session-*.ts` files have other importers and stay.
- `features/projects/`: `ProjectSwitcher` and the project dialogs, one file per settings page (general, members, chat defaults, security policy).
- `NEW_CHAT_ICON` moved to `lib/nav-icons.ts`. The boundary baseline goes from 230 to 239 lines: library→feature 40 → 28, feature→feature 147 → 168, cycles unchanged at 43.
- Nothing users see changed.
