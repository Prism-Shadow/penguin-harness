# Sticky new-chat Workspace

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `web`
- **PR:** #TBD

[中文版](2026-10-20-sticky-new-chat-workspace.zh.md)

A sent conversation's Workspace now carries over to the next draft, next to the model selection: the new-chat composer starts in the Workspace the last conversation was sent from, on its machine, instead of re-seeding from the Project defaults every time.

## Details

- The carry-over lives in the per-user draft cache slot and is written on successful send; an explicit route pick (a workspace group's "+" or an Agent card) still wins, and saving the Project's `[default_chat]` block still releases the cached Workspace so the next draft re-seeds from it.
- Picking the temporary Workspace ("") carries over as "".
- The server default is unchanged: a Session created without a Workspace (API, CLI, handoff) still gets a temporary one.
