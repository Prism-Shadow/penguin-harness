# Backward compatibility: port_forwards without a direction on a numbered root

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `server`
- **PR:** [Myriad-Dreamin/penguin-harness#PRNUM](https://github.com/Myriad-Dreamin/penguin-harness/pull/PRNUM)

[中文版](2026-10-03-backward-compatibility-port-forwards-legacy-shape.zh.md)

A data root left by a build with numbered migrations whose `port_forwards` table has no `direction` column — for example one from the agent-state hand-over line, stamped 14 — failed to boot this line: a hot push answered `migration port-forwards failed: Error: no such column: direction`, and a cold start stopped on the same error. A new migration, `port-forwards-legacy-shape`, declared immediately before `port-forwards`, rebuilds such a table into the current shape first.

## The old shape: `port_forwards` in its first form, no ledger

The table has no `direction` column and a unique `local_port`. Adopting the root runs every migration, and `port-forwards` skips the existing table and then fails on its index over `direction`.

- `port-forwards-legacy-shape` rebuilds the table the way `port-forwards-direction` does: every saved forward is kept as an `in` forward, and both indexes are created. Where the table is missing or already has the column, it does nothing; its `down` does nothing either.
- The runtime's own open runs the same rebuild before the schema declaration, whose index over `direction` failed the same way at a cold start.
- A root that already ran the later migrations runs it once, as its last ledger entry, and nothing changes.

**A user is not required to do anything.**

## When this can be removed

Together with the ledger's adoption of numbered roots: once no supported data root can still lack the ledger, the migration and the call in the runtime's open go at the same time. See [numbered migration stamps](2026-10-02-backward-compatibility-named-migrations.md).
