# Backward compatibility: a data root the machines line stamped 14

- **Date:** 2026-09-28
- **Type:** process
- **Scope:** `server`
- **PR:** [#870](https://github.com/Prism-Shadow/penguin-harness/pull/870)

[中文版](2026-09-28-numbering-fork-adoption.zh.md)

The machines line numbers its migrations 9–14 as `sessions-sandbox`, `machines-columns`, `sessions-surface`, `user-profile-adoption`, `port-forwards` and `browser-sites`. This line put `model-promotions` and `model-provider-auth-tokens` at 9 and 10 and moved the rest up by two, so a root that line stamped 14 met this build in two bad ways:

- **The push was refused.** Migration 15 (`port-forwards`) found that line's `port_forwards` in its first form, with no `direction` column, and its partial index on `direction` failed: `migration 15 (port-forwards) failed: no such column: direction`. Migration 17, which rebuilds such a table, comes after 15 and never ran. A runtime restart on this build failed the same way, one step earlier, in SCHEMA_SQL.
- **Two tables would never arrive.** Stamp 14 reads 9 and 10 as applied, so `model_promotions` and `model_provider_auth_tokens` were never created. The server would boot, then answer 500 on pricing and on Penguin Go token refresh.

Migration 19, `numbering-fork-adoption`, decides by what the tables actually look like, not by the stamp. Its shape repair (`adoptFirst`, a new optional field on a migration) runs ahead of the pending list, and ahead of SCHEMA_SQL when the runtime opens the database. It rebuilds a `port_forwards` table that has no `direction` the way migration 17 does: rows are kept as `in` forwards. Then its `up` creates the two tables with 9's and 10's frozen DDL. It is swap-safe, so it runs on the next push; there is nothing to do by hand. A root that took all of these in their proper place finds the work done. No existing migration's DDL was changed.

## Compatibility

Remove migration 19 and the `adoptFirst` field once no root can still be stamped by the machines line; that line's release is the moment. A root at 19 still opens on a machines-line runtime, which has nothing pending at 19 and writes to the rebuilt `port_forwards` without naming `direction`.
