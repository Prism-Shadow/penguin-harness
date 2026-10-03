# The chat page splits into a controller, a toolbar, a body and panels

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`

[中文版](2026-10-03-web-chat-split.zh.md)

The Web App's chat page, one 2,800-line component, is split along what it does, and the Workspace browser and the model picker leave the chat module.

- `features/workspace/` (the Files panel's browser, the Workspace picker and finder, the tree view, the reply-link provider) and `features/model-picker/` (the catalog select, its dialog and logic, the thinking-level vocabulary) are modules of their own, each with an `index.ts`; `features/chat/body/` takes the draft view. The paperclip glyph moved to `lib/attachments.ts`.
- `chat-page.tsx` only composes (under 200 lines): `session/use-chat-session.ts` is the controller, made of consecutive sub-hooks called in the original component's order; `toolbar/` holds the toolbar, the details card, the process list and the header statistics; `body/` the body and the composer; `session/session-dialogs.tsx` the three dialogs; `panels/render-panel.tsx` the dock panel bodies, still one `renderPanel` over `PanelKind`.
- `DRAFT_SESSION_ID` moved to `draft-sessions.ts`. Other features reach chat only through `features/chat/index.ts` (the new-chat draft's route and cache, the Skill text helpers, the stream follower, the panel width). `pickDefaultAgent` moved to `lib/default-agent.ts`, so chat no longer imports ai-create.
- The boundary baseline goes from 156 to 141 lines: feature→feature 122 → 101, cycles 34 → 40 (the two new modules sit on the cycles their files were on inside chat).
- Nothing users see changed.
