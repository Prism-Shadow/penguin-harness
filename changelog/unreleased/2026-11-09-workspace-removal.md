# Removed Workspaces stay hidden while retaining their conversations

- **Date:** 2026-11-09
- **Type:** fix
- **Scope:** `web`

[中文版](2026-11-09-workspace-removal.zh.md)

Fixed Remove workspace leaving a group visible when it contained conversations and then
removing its own menu option. Removal now hides the group across reloads, without deleting or
archiving its conversations or changing files on disk. Adding the same directory on the same
machine again restores the group with its existing conversations.

Groups whose registration had already been removed regained the Remove option. Hidden groups
were scoped to the current Project and browser, with separate entries for each machine.
