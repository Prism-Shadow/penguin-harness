# @prismshadow/penguin-library-db

The server's SQLite database as a library package — #255's restack, step L01.

## What lives here

- `src/database.ts` — the connection: `openDatabase` (creating: PRAGMAs, table
  creation, the per-column guards, the one-time backfill, then migrations),
  `openExistingDatabase` (a narrow write against a live server's lock),
  `openDatabaseReadOnly` (a reader that cannot reshape a schema), and
  `ensureColumn` (the idempotent per-column guard).
- `src/schema.ts` — the table-creation SQL (`SCHEMA_SQL`), importable without
  opening anything.
- `src/migrations/` — the ledger: the `Migration` shape, the runner, and the
  named steps; `migrate` and `rollbackTo` over `MIGRATIONS`.
- `src/index.ts` — the package face plus the `Db` capability class (the
  runtime's published SQLite handle: `prepare`/`exec`/`close`).

## What deliberately does NOT live here (yet)

The table repos (`users.ts`, `sessions.ts`, `server-settings.ts`, …). Each repo
implements one domain's contract and moves with that domain into its own
library package (L02+: `library/settings` takes `server-settings` and
`ui-prefs`, and so on). They stay under `packages/server/src/db/repos/` until
their domain step.

## The dependency rule

This package depends on `@prismshadow/penguin-core` (the kernel's `Interface`
and `Opaque`) and Node built-ins — nothing else. `packages/server` imports
this package; nothing here imports the server. The one-directional flow is
what lets every package's build run in topological order without the
cross-package declaration deadlock the first restack attempt hit.
