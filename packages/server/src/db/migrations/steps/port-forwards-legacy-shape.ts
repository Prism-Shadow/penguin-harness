import type { Migration } from "../migration.js";
import { portForwardsDirection } from "./port-forwards-direction.js";

export const portForwardsLegacyShape: Migration = {
  name: "port-forwards-legacy-shape",
  // Declared BEFORE port-forwards, not appended, because it has to run before it. A numbered
  // root whose build created `port_forwards` in its first form (no `direction`; e.g. the
  // agent-state hand-over line, stamped 14) is adopted by running every migration, and
  // port-forwards' DDL was changed in place to the current shape: its CREATE TABLE IF NOT
  // EXISTS skips the old table and its partial index on `direction` then fails, so the boot
  // stops before port-forwards-direction, which would have repaired the table, ever runs.
  // Rebuilding the table first lets port-forwards find its work done.
  //
  // Reuses port-forwards-direction's `up` — the same frozen rebuild, a no-op without the
  // table or with the column — rather than a third copy of its SQL. openDatabase runs it
  // ahead of SCHEMA_SQL too, whose index on `direction` fails the same way at a cold start.
  // On a root that already ran the later migrations it runs last and does nothing.
  //
  // TODO(numbered-root-adoption): exists only for numbered roots with the first form of the
  // table; remove together with the ledger's adoption of numbered roots (index.ts).
  swapSafe: true,
  up(db) {
    portForwardsDirection.up(db);
  },
  // Nothing to undo: the shape it produces is port-forwards-direction's, whose down reverts it.
  down() {},
};
