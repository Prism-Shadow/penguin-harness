# The dock's panels and the workflow tab strip are slot contributions

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`

[中文版](2026-10-03-web-chat-slots.zh.md)

The chat page no longer names the dock panels or the workflow tabs beside it; the modules that own them contribute them.

- The dock module declares `DockModule.panels` (`features/dock/iface.ts`): a panel kind's name, mark and menu order are data, its body is the code half. Chat contributes the agents and memory panels, the new `WorkspaceModule` and `TracesModule` the Files and Trace panels, and messaging, schedules, the built-in browser and port forwarding theirs. `panels/render-panel.tsx`, `features/dock/panel-meta.tsx` and the five dictionary entries only they read are gone.
- A panel body reads the conversation it is docked beside with `useChatSession()` (`lib/chat-session.ts`) and shows its own draft placeholder (`lib/dock-panel-empty.tsx`). The page's controller hook is renamed `useChatController()` (`session/use-chat-controller.ts`).
- `PanelKind` is a string. The stored dock layout keeps its format; a stored tab of a kind no module contributes is dropped when the layout is read, and the dock's other tabs stay.
- The chat module declares `ChatModule.sessionTabs`; workflows contributes the tab strip and its page frame.
- The shared side-panel width moved from chat to the dock, so the dock no longer imports chat. Chat no longer imports traces, messaging or workflows.
- The boundary baseline goes from 183 to 158 lines: feature→feature 132 → 122, cycles 51 → 36.
- Nothing users see changed.
