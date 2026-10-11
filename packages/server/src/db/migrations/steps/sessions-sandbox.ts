import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const sessionsSandbox: Migration = {
  name: "sessions-sandbox",
  // The Session's own sandbox policy (JSON), snapshotted from the server's settings when
  // the Session is created, so a later settings change leaves running Sessions alone.
  // NULL = a row from before this column: it takes the settings in force at its next
  // command and keeps them from then on. Swap-safe: a pushed platform boots against the
  // runtime's already-open database, so the column has to arrive by a migration.
  swapSafe: true,
  up(db) {
    ensureColumn(db, "sessions", "sandbox", "TEXT");
  },
  // Not a DROP: schema.ts declares the column, and dropping it would put every Session
  // back under whatever the settings say.
  down() {},
};
