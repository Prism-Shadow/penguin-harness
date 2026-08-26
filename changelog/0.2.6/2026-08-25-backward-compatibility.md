# Backward compatibility

- **Date:** 2026-08-25
- **Type:** process
- **Scope:** `cli`, `server`, `web`, `desktop`
- **PR:** [#466](https://github.com/Prism-Shadow/penguin-harness/pull/466), [#477](https://github.com/Prism-Shadow/penguin-harness/pull/477)
- **Breaking:** yes — old CLI binaries ran tasks core-direct and offline; the rebuilt commands require a server (auto-started locally), the per-user "show CLI sessions" preference is gone, and a Windows desktop client installed from 0.2.4 refuses this update after the signing identity change

[中文版](2026-08-25-backward-compatibility.zh.md)

This release touches four kinds of existing state — three from the CLI-on-server batch, one
from the Windows signing change. What breaks without handling, and what was chosen:

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

## The Windows update publisher name

Installers through v0.2.4 were signed by `RushRush Network Technology Ltd`, and each installed
client recorded that one name as `publisherName` in its own `app-update.yml`. Builds from this
release on are signed by `NaisNet Technology Co., Ltd.`. electron-updater verifies a downloaded
update against the names the **installed** client holds, and that file is written once at install
time, so nothing in this repository can reach a client that already exists: a Windows desktop
client installed from 0.2.4 or earlier refuses this update and has to be reinstalled by hand. That
break is accepted and stated here. Nothing under `~/.penguin/data` is affected, and the CLI, the
Linux packages and the notarized macOS builds are not involved.

Forward, the field is a list rather than one name, and it carries the previous identity alongside
the current one — each in the full-DN and bare-CN forms electron-updater compares. A client
installed from this release therefore still accepts a build signed by the next certificate, so the
next rotation does not repeat this. A retired identity leaves the list once no supported client was
installed by a release that signed with it; until then it is trusted by builds it did not sign,
which is the cost of the arrangement.

## Compatibility

Nothing on disk has to be migrated, and on macOS, Linux and the CLI no action is required to keep
an install working.

Reinstall the Windows desktop app once, from
[penguin.ooo/download](https://penguin.ooo/download). A client installed from 0.2.4 or earlier
cannot auto-update onto the new signing identity, because the publisher list it recorded at install
time holds only the old one; from that reinstall onward auto-update works again and accepts either
identity. See [the signing entry](2026-08-27-windows-signing-publisher.md).

Update the CLI along with the server: `penguin run` and `penguin chat` are server-backed from this
version on, and an old binary keeps executing against its own core until it is replaced. Where a
CLI cannot start a server — a `tsx` development entry that is not re-runnable — start one first, or
point the command at a running install with `--server` plus `PENGUIN_API_TOKEN`. A workflow that
relied on the CLI running a Task with no server at all moves to the SDK, which keeps core-direct
execution. Nobody has to clear a stored `showCliSessions` preference; it is ignored where it sits.
