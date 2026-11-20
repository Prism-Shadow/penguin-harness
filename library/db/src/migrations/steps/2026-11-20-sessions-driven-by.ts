import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const sessionsDrivenBy: Migration = {
  name: "2026-11-20-sessions-driven-by",
  // The person who last started a run in a Session, recorded so a plugin command that runs for
  // that person (`tokenCaller: "session-driver"`) answers the same after a restart. Existing rows
  // stay NULL — nobody recorded — until a person starts a run in them; such a command refuses
  // there rather than guessing. Swap-safe: a pushed platform boots against the runtime's
  // already-open database, so the column has to arrive by a migration.
  swapSafe: true,
  up(db) {
    ensureColumn(db, "sessions", "driven_by", "TEXT");
  },
  // Not a DROP: schema.ts declares the column, and dropping it would forget every Session's
  // driver.
  down() {},
};
