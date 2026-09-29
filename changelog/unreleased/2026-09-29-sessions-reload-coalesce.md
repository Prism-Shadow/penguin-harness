# Reloads of the Sessions list are merged into one round at a time

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-29-sessions-reload-coalesce.zh.md)

A reload of the Sessions list asks every source about every Agent. Each trigger (a new Session, a scheduled run, a resync) used to start its own round at once. So while one round waited on a slow machine, a busy Project kept adding rounds, and their calls piled up in the browser (`net::ERR_INSUFFICIENT_RESOURCES`). Now at most one round is in flight and at most one waits behind it.

## Details

- A trigger that arrives while a round is in flight joins the round queued behind it. That queued round starts when the one in flight ends, and it reads the list as it stands then. Any number of triggers in between cost one more round.
- A reload for another list (a Project switch, or a changed Agent set) does not wait. It starts at once, and the answers of the round it overtook are dropped, as before.
