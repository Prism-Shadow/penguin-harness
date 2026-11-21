# Backward compatibility: two forms of the `port_forwards` table

- **Date:** 2026-09-22
- **Type:** process
- **Scope:** `server`

[中文版](2026-09-22-backward-compatibility.zh.md)

The `port_forwards` table has been carried by more than one line of builds, and its first deployed form had no `direction` column. Two small migrations bring every such root to the current shape; neither needs anything done by hand.

## A root that has the migration's record without the table

A data root can come to hold the `2026-10-11-port-forwards` migration's ledger record without the table behind it — a database that traveled between machines and lines can carry a record whose table was left behind by a build this build cannot see. The port-forwards module lists the table when the App starts, so a root without it exits before it listens.

`2026-10-11-port-forwards-adoption` creates the table where it is missing — with the FIRST DDL of `2026-10-11-port-forwards`, all `IF NOT EXISTS`, frozen: it documents what those roots have. Nothing to do by hand: it runs at the next start or the next push, and a root that has the table finds its work done.

## A root with the first form of `port_forwards` cannot take a forward

The DDL of `port_forwards` was widened in place (a `direction` column, uniqueness per direction) after roots had already run its first form — and a recorded migration is never re-run, so such a root kept a table the platform can no longer write to: `POST /api/port-forwards` answered 500 with `no such column: direction`. The adoption above creates that same first form on the roots it adopts.

`2026-10-11-port-forwards-direction` rebuilds such a table into the current shape — rows kept as `in` forwards, `direction` defaulting to `in` so a rolled-back predecessor still writes to it — and leaves a table that already has the column alone. Swap-safe: it runs on the next push. Nothing to do by hand.

## Compatibility

Both entries can go once every data root has run `2026-10-11-port-forwards-direction`. Removing them is two entries deleted from `MIGRATIONS`. The DDL of `2026-10-11-port-forwards` is not touched again.
