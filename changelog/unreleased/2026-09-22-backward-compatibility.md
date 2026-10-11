# Backward compatibility: two forms of the `port_forwards` table

- **Date:** 2026-09-22
- **Type:** process
- **Scope:** `server`
- **PR:** [#804](https://github.com/Prism-Shadow/penguin-harness/pull/804)

[中文版](2026-09-22-backward-compatibility.zh.md)

## A root that ran the closed #797 line has no `port_forwards` table

While migrations were still numbered, a data root that ran a build of the closed [#797](https://github.com/Prism-Shadow/penguin-harness/pull/797) line carried a stamp that this line read as "`port-forwards` already applied". Such a root reached the latest version without the `port_forwards` table — and the port-forwards module, which lists the table when the App starts, threw at boot: the server exited before it listened. Every machine a server on that line handed this build to was left this way.

`port-forwards-adoption` creates the table where it is missing — with the FIRST DDL of `port-forwards`, all `IF NOT EXISTS`, frozen: it documents what those roots have. Nothing to do by hand: it runs at the next start or the next push, and a root that took `port-forwards` in its proper place finds its work done.

## A root with the first form of `port_forwards` cannot take a forward

The DDL of `port-forwards` was changed in place on this branch (a `direction` column, uniqueness per direction) after a few development roots had already run its first form (53531 and 53899 among them) — and a recorded migration is never re-run, so those roots kept a table the platform could no longer write to: `POST /api/port-forwards` answered 500 with `no such column: direction`. `port-forwards-adoption` creates that same first form on the roots it adopts.

`port-forwards-direction` rebuilds such a table into the current shape — rows kept as `in` forwards, `direction` defaulting to `in` so a rolled-back predecessor still writes to it — and leaves a table that already has the column alone. Swap-safe: it runs on the next push. Nothing to do by hand.

## Compatibility

Both entries can go once no data root can still come from the #797 line and every root on this line has run `port-forwards-direction` — the machines line's release is the moment. Removing them is two entries deleted from `MIGRATIONS`. The DDL of `port-forwards` is not touched again.
