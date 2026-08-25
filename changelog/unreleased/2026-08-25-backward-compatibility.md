# Backward compatibility

- **Date:** 2026-08-25
- **Type:** process
- **Scope:** `cli`, `server`, `web`
- **Breaking:** yes — old CLI binaries ran tasks core-direct and offline; the rebuilt commands require a server (auto-started locally) and the per-user "show CLI sessions" preference is gone

[中文版](2026-08-25-backward-compatibility.zh.md)

The CLI-on-server batch touches three kinds of existing state. What breaks without
handling, and what was chosen:

## Legacy CLI-direct traces on disk

Sessions run by the old core-direct CLI exist only as Trace files, with no row in the
server's session index. Without handling they would silently vanish from every list now
that lists are pure-SQLite. Chosen: a **startup adoption sweep** — once per server boot the
trace tree is walked (through the existing mtime-gated TraceIndexService discovery path)
and every unmanaged session is adopted as a `client:'cli'` index row; afterwards lists
never scan the filesystem. The sweep is idempotent and stays for as long as pre-server
CLI traces can exist on disk, i.e. indefinitely at negligible cost (one gated reconcile
per boot); removing it would orphan any root restored from an old backup.

## The retired `showCliSessions` preference

The per-user pref and its `cli=1` query parameter are gone; every session is always
listed. A stored `showCliSessions` key in `ui_prefs` is simply ignored by the shallow
merge — stale JSON keys are tolerated forever by design, so no migration runs and nothing
needs cleaning up. Users who kept the toggle off will now see their old CLI sessions in
the sidebar and the trace tree; that is the intended new behavior, not a bug. External
API callers still sending `cli=1` get the parameter ignored (the listing is already the
superset they asked for).

## Old CLI binaries and the new transport

The old `penguin run` / `penguin chat` executed tasks in-process against core, worked with
no server, and left server-invisible traces. The rebuilt commands are server-backed: with
no server running they auto-start one locally (exit with a clear error only when the
entry is not re-runnable, e.g. a tsx dev run). Accepted break, stated here: fully offline
core-direct execution is no longer a CLI mode — the SDK keeps that capability for
embedders. Old binaries keep working against their own cores until updated; nothing on
disk stops them.
