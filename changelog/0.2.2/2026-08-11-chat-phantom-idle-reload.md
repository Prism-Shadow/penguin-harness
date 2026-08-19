# Web App: no more phantom list reloads when leaving a running conversation

- **Date:** 2026-08-11
- **Type:** fix
- **Scope:** `web`
- **PR:** [#242](https://github.com/Prism-Shadow/penguin-harness/pull/242)

[中文版](2026-08-11-chat-phantom-idle-reload.zh.md)

The chat page reloads the session and Agent lists when a Task finishes (a turn may have
spawned a sub-session or auto-created an Agent). That trigger watched only the stream's
task state — but the stream also resets to "idle" whenever it detaches, so **switching
conversations or clicking "new conversation" while a Task was still running** fired the
same reload pair. Both sidebar contexts refetched and the whole app re-rendered right
after the click, occasionally visible as an uncontrolled flicker on entering the draft
page ([#242](https://github.com/Prism-Shadow/penguin-harness/pull/242)).

The trigger is now guarded by session identity: only a running→idle transition observed
on the SAME session counts as a completion. On a switch the tracker restarts from idle —
a state seen in the same commit as the id change still belongs to the previous stream.
Completions that finish while another conversation is open still reach the sidebar
through the session events channel.
