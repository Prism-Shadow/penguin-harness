# Backward compatibility: two forms of the `port_forwards` table

- **Date:** 2026-09-22
- **Type:** process
- **Scope:** `server`
- **PR:** [#806](https://github.com/Prism-Shadow/penguin-harness/pull/806)

[中文版](2026-09-22-backward-compatibility.zh.md)

## A root stamped by the closed #797 line has no `port_forwards` table

One numbering of the database migrations outlives the line it came from: a data root that ran a build of the closed [#797](https://github.com/Prism-Shadow/penguin-harness/pull/797) line is stamped 13, where 13 meant `company-mode-org-caches-adoption`. On this line 13 is `sessions-surface`, so such a root reads every migration up to its stamp as applied — `port-forwards` (15) included once the stamp passes it — and reaches the latest version without the `port_forwards` table — and the port-forwards module, which lists the table when the App starts, throws at boot: the server exits before it listens. Every machine a server on that line handed this build to was left this way.

Migration 16, `port-forwards-adoption`, creates the table where it is missing — with the port-forwards migration's FIRST DDL, all `IF NOT EXISTS`, frozen: it documents what those roots have. Nothing to do by hand: it runs at the next start or the next push, and a root that took `port-forwards` in its proper place finds its work done.

## A root with the first form of `port_forwards` cannot take a forward

The port-forwards migration's DDL was changed in place on this branch (a `direction` column, uniqueness per direction) after a few development roots had already run its first form (53531 and 53899 among them) — and a stamped migration is never re-run, so those roots kept a table the platform could no longer write to: `POST /api/port-forwards` answered 500 with `no such column: direction`. Migration 16 creates that same first form on the roots it adopts.

Migration 17, `port-forwards-direction`, rebuilds such a table into the current shape — rows kept as `in` forwards, `direction` defaulting to `in` so a rolled-back predecessor still writes to it — and leaves a table that already has the column alone. Swap-safe: it runs on the next push. Nothing to do by hand.

## Compatibility

Both entries can go once no data root can still be stamped by the #797 line and every root on this line has run 16 — the machines line's release is the moment. Removing them is two entries deleted from `MIGRATIONS`, together with the numbering note on 13. Migration 13's DDL is not touched again.
