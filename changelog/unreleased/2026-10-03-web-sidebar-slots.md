# The sidebar fills itself from slots

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`

[中文版](2026-10-03-web-sidebar-slots.zh.md)

The Web App's sidebar frame, collapsed rail and app layout no longer import any feature's inner files: what the features put in them arrives through module slots and interfaces.

- `SidebarModule` (`web-app/sidebar/`) provides `Sidebar` (the column, the rail, the layout's view of them) and declares three slots: `sections` (a block of a work mode, in the switcher row or the scroll area; a section's scope stays mounted across a mode switch, so the session list keeps its state), `modes` (a work mode beside development) and `navBadges` (a mark on a page row, the account row or the phone's drawer button). The shapes a contributor implements are in `lib/sidebar-contributions.ts`.
- `ChatDrafts` (`features/chat/iface.ts`, exported from the new `features/chat/index.ts`) is the chat module's drafts interface: the session list and the WebApp `@Use` it in place of the draft files.
- `SessionListModule` contributes the development-mode section and declares `rowActions` (an entry in a conversation row's or a Workspace group's menu, or a row mark; shapes in `lib/session-row-contributions.ts`). Messaging contributes the binding entry and the relay mark, schedules the scheduled mark, the dock "Browse files".
- Company contributes its mode — whose nav rows include the company-mode pages plugins contribute — its four sections (switcher, channels, roadmaps, desks) and the proposals' unread count as a nav badge on that page's row; projects its switcher; models the balance on the account row; to-dos the update dots and, as a session provider, their one eager owner. The dock's scope and the Settings dialog become layers; `settings-request.ts` moved to `lib/`.
- Nav rows are drawn from the page table: `WebAppModule.pages` data gains `title` / `titleZh` / `icon` (an icon registry name). The closed `NavGroupKey` union, the `NAV_ICONS` entries and `S.nav` / `S.company` strings that only the nav used are gone; stored nav fold and pin choices keep their keys and values.
- The boundary test treats `shell/` as a module directory (other modules only through their `index.ts`). The baseline goes from 239 to 200 lines: library→feature 28 → 0, feature→feature 168 → 155, cycles 43 → 45 (the company→WebApp edges of the contributed-pages reader, now that `shell/` is a module).
- Nothing users see changed.
