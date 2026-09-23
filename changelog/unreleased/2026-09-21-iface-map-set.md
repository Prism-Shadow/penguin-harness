# An interface may carry a Map or a Set, checked by its element types

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `core`, `server`
- **PR:** [#817](https://github.com/Prism-Shadow/penguin-harness/pull/817)

[中文版](2026-09-21-iface-map-set.zh.md)

The interface table gained two type expressions, `{ map: [K, V] }` and `{ set: T }`. The
generator used to refuse `Map` and `Set` outright, so a node that held one could only declare it
as `Opaque<…>`, which is compared by name alone.

## Details

- `scripts/gen-ifaces.mjs` projects `Map<K, V>` / `ReadonlyMap<K, V>` as `{ map: [K, V] }` and
  `Set<T>` / `ReadonlySet<T>` as `{ set: T }`. The key, value and element types are projected like
  any other, so a Map of live objects reaches their interfaces through the table.
- `extendsExpr` in core's kernel compares them the way it compares an array: a Map by its key and
  its value, a Set by its element. A Map is never a Set, and neither is an array.
- `WeakMap` and `WeakSet` are still refused: their keys are object identities, which two
  compilations cannot compare.
- The interface page (`pnpm ifaces:page`) renders both.
- The first user is the server's new `AgentState` node, which holds the Session runtime's
  in-memory state — the active table, the per-Session locks, the two deletion-window sets, the
  Agent config generations and the live tail — so that `SessionManager` keeps its logic and the
  node keeps the memory. Its interface is checked member by member: no `Opaque` in it.
