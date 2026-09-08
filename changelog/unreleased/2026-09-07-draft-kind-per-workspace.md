# A new chat opens the way that Workspace was last opened

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `web`
- **PR:** [#644](https://github.com/Prism-Shadow/penguin-harness/pull/644)

[中文版](2026-09-07-draft-kind-per-workspace.zh.md)

The draft page's third pill chooses what a new chat opens: a conversation, or one of the surfaces a plugin contributes — Claude Code being the first of them. It started at "conversation" every time, so a repository that is only ever driven through Claude Code cost the same two clicks on every visit.

The pick is now remembered against the Workspace it was made in, and re-applied whenever that Workspace is selected again — on arriving at the page, and on switching the Workspace pill. The directory next to it keeps its own answer: one Project can have a repository driven through Claude Code and another that is always a conversation, and neither has to be corrected. A machine is part of which Workspace this is, so the same path on two machines is two Workspaces with two memories.

It is kept out of the draft cache on purpose, because that cache is cleared by the send it belongs to; this is a standing preference and has to survive one. Like the cache, it is stored per browser and isolated by user and Project. A remembered surface whose plugin the Project no longer loads falls back to the conversation instead of offering a composer that can only say "unavailable".
