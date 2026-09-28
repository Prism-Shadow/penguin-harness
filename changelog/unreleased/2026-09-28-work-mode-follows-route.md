# The mode switch, the sidebar and the page stand in one mode

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `web`
- **PR:** [#869](https://github.com/Prism-Shadow/penguin-harness/pull/869)

[中文版](2026-09-28-work-mode-follows-route.zh.md)

With the mode switch on Company, the shell could show a development page inside the company sidebar: typing `/chat/new` (or following any link to a conversation) left the switch and the sidebar on Company, and the desktop shell, started on a data root last left in company mode, opened on the new-chat page with the company sidebar around it. The page and the mode now always agree.

## Details

- Entering the new-chat draft, a parked draft or one of the user's own conversations switches the shell to development mode, the way entering an organization page already switches it to company mode. An organization's desk or ticket Session switches nothing: both modes reach it.
- `/`, the page after signing in, and any path nothing matches now land on the home of the current mode — the organizations (`/org`) in company mode, the conversations (`/chat`) in development mode. The desktop shell arrives at `/` on start, so it now opens where it was left.
- A mode chosen in this page load — with the switch, or by entering a page of that mode — is no longer overturned when the stored preferences arrive a moment later; before, a fresh browser opening `/chat/new` could flip to Company around the development page.
