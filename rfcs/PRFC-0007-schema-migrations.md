# PRFC-0007: Schema changes are ordered, stamped, run-once migrations

[中文版](PRFC-0007-schema-migrations.zh.md)

> **Source**: `rfcs/PRFC-0007-schema-migrations.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — landed (default branch `main`, commit [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)).
> **Rev**: v1.0.0 (migrated into the main repository); the conventions for this surface are in [README.md](README.md), and per-version changes are recorded in the `## Changes` section at the end.

- Feature Name: `schema-migrations`
- Start Date: 2026-09-02
- PRFC PR: [Prism-Shadow/penguin-harness-design#111](https://github.com/Prism-Shadow/penguin-harness-design/pull/111)
- Implementation PR: [Prism-Shadow/penguin-harness#524](https://github.com/Prism-Shadow/penguin-harness/pull/524)

## Summary
[summary]: #summary

Schema changes to `web.db` are written as ordered, version-stamped, run-once migrations. One axis of this was forced by hot updates: a migration must declare whether it is safe to run on a **rollback-able startup path**, and the unsafe ones are rejected as a whole batch before touching the database.

## Motivation
[motivation]: #motivation

### "Keep every change incremental" was never a strategy anyone chose

`schema.ts` declares what a **brand-new** database gets created as. It cannot express a **change**: repeatedly running `CREATE TABLE IF NOT EXISTS` only converges the database toward the current declaration, neither knowing nor recording what state it came from.

So no build can tell a 0.2.4 database apart from a 0.2.7 database. "Keep every change incremental" sounds like a discipline, but it was in fact the **only reachable** safety property at the time — because there was no way to judge whether any non-incremental change should be made.

### A real failure

A server running 0.2.4 rejected the pushed new platform twice, reporting `no such table: messaging_bindings`, and rolled back both times.

The reason: that table is needed by the new platform's business logic, and it exists only in the newer version's `schema.ts`. That server's runtime will never grow this table from a restart — it was never in its own declaration. The push brought platform code, not database shape.

That server either upgrades its runtime (a reinstall), or never receives this push. And the entire value of hot updates lies in not having to do that.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

Writing a schema change means adding a migration: a version number, an `up`, a `down` (explicitly `null` if there is none), and a `swapSafe` flag.

`swapSafe` asks one concrete question: **after this migration has run, if the platform version taking over the database is older than it, will that version break?** Adding a table, adding a column — the old platform does not know they exist and so never touches them — safe. Dropping a column, adding a NOT NULL constraint, changing a type — the old platform will run into them — unsafe.

The reason this question must be asked: a pushed platform starts up on a live database, and **if startup fails it rolls back to its previous version** — and that previous version then has to face what the migration has already done.

So the two paths are separated:

| Who is running | What may run |
| --- | --- |
| `openDatabase` — owns this process | Anything |
| The hot-push startup path — may be rolled back | Only `swapSafe` ones; the rest are **rejected as a whole batch** before touching the database, raising a `RestartRequiredError` |

A discipline that previously had to be remembered through review thereby becomes mechanical.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### DDL freezing

A migration hard-codes its own SQL and never imports `SCHEMA_SQL`. Referencing a living declaration would let an old migration **silently change meaning** after every schema change — and "what this migration actually did at the time" being checkable is the entire property that makes migrations auditable.

### One-directional, ordered, never rewritten

Versions are consecutive from 1 onward, and once released they are never renumbered or rewritten. A database that has already stamped version N never runs N again, so editing N only changes what new databases get, and silently forks old and new.

This rule actually bit once during review: 0.2.8 landed while review was in progress, and the added fields became **migration #2** instead of an edit to migration #1 — because the production server had already stamped 1 and would never run it again. The rule made the decision itself; it was nobody's preference.

### Migrations are applied by the hot-push path

Because it is the only path that reaches a runtime **older** than the migrations. The pushed platform carries its own migrations, so the tables travel with the push; that 0.2.4 server now runs the current business logic, and its runtime has not been reinstalled even once.

### `down` is not a hot-update rollback

When a pushed platform fails to start, the runtime goes back to the previous version, and **the schema stays where the migrations left it**.

Undoing DDL inside a process that just failed to start amounts to running destructive statements against a half-understood state. And the whole point of `swapSafe` is to make "not undoing" safe: the previous version does not know that new table or column at all, so it never touches them.

`down` is a tool invoked manually by operators, run from newest to oldest by version, each migration together with its version stamp inside one transaction; if even one migration in the range is irreversible, the whole batch is **rejected before touching the database** — otherwise the database would be left at a version whose meaning nobody ever wrote down. It is inherently lossy; every `down` must state clearly which rows it discards.

### Migrations must be idempotent

Databases formed before migrations existed are all read as version 0, and their actual shapes differ, so a migration must tolerate finding its own work already done.

This is not only a matter for the first migration: `SCHEMA_SQL` still fully declares the current shape, and the `ensureColumn` list still runs when a database is opened, so **any** migration may find that the declarative track has already done its work for it. Only once the declaration is frozen into a baseline does a bare `CREATE TABLE` that fails loudly become the point.

## Drawbacks
[drawbacks]: #drawbacks

**Two tracks coexist.** The declarative track (`SCHEMA_SQL` plus its `ensureColumn` list and a few index retirements) lives alongside the migration track, and a reader of the code needs to know that a table may be produced by either one. Freezing the declaration into a baseline would touch every existing table and so has to be a separate change.

**Idempotency is a long-term burden**, and it is necessary only in the intermediate state — but that intermediate state lasts until the baseline freeze, and until then every new migration has to be written with it.

**Column order never aligns.** `ALTER TABLE ADD COLUMN` appends at the end, while a brand-new database places columns where the declaration puts them. Aligning would mean rebuilding tables, which is not incremental and would take the rollback guarantee away with it. So "two databases of the same version, schema-equivalent but with different column orders" is a fact to accept (the column order inside an index, however, must be identical — for a composite index that order is the index itself).

**`swapSafe` rests on the author's judgment.** No mechanical means can verify that a migration is mislabeled; the consequence of a mislabel is that after a rollback the old platform runs into a shape it does not recognize.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**Keep only the declarative approach** (the status quo). It cannot express changes, so every non-incremental idea has to be dropped — and the reason for dropping it is not "it should not be done" but "there is no way to do it safely". The two rollbacks of that 0.2.4 server are where this road ends.

**Use an off-the-shelf migration library** (Knex, Drizzle, Prisma migrate, and the like). They all provide ordered, stamped migrations, but none has the `swapSafe` axis — they assume the process that runs the migrations is the same process that will serve next. The premise here is different: the platform that runs the migrations may be rolled back within seconds, and what takes over is an older version. That axis is the core of this design, not a part that can be outsourced.

**Drop `swapSafe` and require a restart for every change.** Simple, but it amounts to declaring that "no feature touching the database can be hot-pushed", and most of this harness's features touch the database.

**Automatically run `down` on startup failure.** It sounds symmetric; in practice it is running destructive statements against a half-understood state inside a process that just failed. `swapSafe` makes not undoing the safe option, which is far easier — and more honest — than making undoing reliable.

## Prior art
[prior-art]: #prior-art

**Rails' ActiveRecord migrations** established this shape: ordered, version-stamped, run-once, with up and down. The skeleton of this design comes directly from it.

**Flyway** has an iron rule identical to "never rewrite a released migration": an already-applied migration is not editable, and Flyway enforces this with checksums. We rely on the fact that "a database that has stamped N never runs N again" — the effect is the same, and editing one only forks old and new paths.

**The expand / contract (parallel change) pattern** is `swapSafe`'s legitimate ancestor. In a rolling release, old and new code run against the same database at the same time, so a schema change is split into two steps: the expand phase does only additions, compatible with old code; the contract phase does the narrowing and must wait until the old code is fully taken offline. Our `swapSafe` is the expand phase, only with a different trigger — not "wait until the old code goes away", but "this startup may roll back to old code".

**Django's migrations** add a dependency graph and autogeneration, suited to scenarios where multiple applications each evolve their own schemas. Here there is one database and one linear history, and that layer of complexity buys nothing.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

**When to freeze `SCHEMA_SQL` into a baseline** — it touches every existing table — and how to handle the variously-shaped legacy databases at freeze time — only once this step is done can the idempotency burden be unloaded.

**Whether to give operators an explicit "I know it will restart, go ahead" switch**, so that non-`swapSafe` migrations can be deliberately let through on the push path. Today the answer is unconditional rejection, which is safer, but it also means some changes must go through a reinstall.

## Future possibilities
[future-possibilities]: #future-possibilities

Machine adds a dimension to this: each machine has its own data root and database, so one push may simultaneously face several databases at different versions. Today each migrates on its own, unaware of the others; "which version is each database in this fleet at" is a question nobody has answered yet, but one that will have to be answered sooner or later.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the landed version from the design repository's default branch, identical to the source file.
