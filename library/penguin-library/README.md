# @prismshadow/penguin-library

The server's domain contracts and their repos as one package. Each domain keeps
its own subpath and barrel (`./session`, `./session/repos/sessions`, …); the
root re-exports every domain barrel.

## The dependency rule

This package depends on `@prismshadow/penguin-core` (the kernel's `Interface`
and `Opaque`), `@prismshadow/amsp` (the wire vocabulary the contracts name) and
its own subpaths — nothing else. `packages/server` imports these contracts; no
subpath here imports the server. The repos take the `Db` capability from the
`./db` subpath.

## The db domain

`src/db/` carries what every repo shares: `openDatabase` and
`openDatabaseReadOnly` (a reader that cannot reshape a schema), `ensureColumn`
(the idempotent per-column guard), the table-creation SQL (`schema.ts`), and
the migrations ledger (`migrations/` — the `Migration` shape, the runner, and
the named steps; `migrate` and `rollbackTo` over `MIGRATIONS`). The `Db`
capability class is the runtime's published SQLite handle:
`prepare`/`exec`/`close`.

## What deliberately does NOT live here

Code outside the storage-and-contract layer: the server's HTTP routes,
services, and runtime assembly all stay in `packages/server`, which imports
these contracts — never the other way round.
