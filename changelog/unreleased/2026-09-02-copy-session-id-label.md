# "Copy Session ID", placed after archive

- **Date:** 2026-09-02
- **Type:** fix
- **Scope:** `web`, `docs`

[中文版](2026-09-02-copy-session-id-label.zh.md)

The Session row's id-copy action is now labelled **Copy Session ID** (Chinese: 复制 Session ID) wherever it appears — the context menu and the details card's copy button — and it moved within the context menu to sit between archive and delete. The menu now runs pin, rename, remote control, archive, copy Session ID, delete: the actions that change the Session first, then the one that changes nothing, beside the one that ends it.

## Details

- `chat.copySessionId` carries the new label in both dictionaries; `contextMenuActions` carries the new order for pinnable and folder rows alike, and the unit test and e2e assertion follow it.
- The Web App docs list the menu in its new order.
