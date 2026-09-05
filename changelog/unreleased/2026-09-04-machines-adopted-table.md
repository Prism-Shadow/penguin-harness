# A machines table from before its migration gains its columns, and a failed job always offers the way out

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `server`

[中文版](2026-09-04-machines-adopted-table.zh.md)

Two things found by connecting to a machine from an installation whose data root had run the machines line before it was released. The connect failed at "Opening the connection…" with `table machines has no column named session_pid`: migration 4 creates the machines tables with `IF NOT EXISTS`, so a table already there was adopted with the columns it had — forwards, not sessions — and the row the connect writes named a column it lacked. Then nothing offered a way on: the install-anyway button appears only on the failures that named it, and this one did not.

## Details

- Migration 5, `machines-columns`, adds `session_pid` and `platform` to a machines table that lacks them, and leaves one that has them alone. Additive and swap-safe, so a hot push applies it; its undo does nothing, since migration 4 declares the same columns.
- Every failed install or connect now offers installing the program anyway. The offer is withheld from a run that was itself that install, and from the one failure installing could not mend — this server having no build of its own to send, which the result now says with `canReplaceProgram: false`. It is still never taken on the page's own initiative: it restarts a server other people may be using.
