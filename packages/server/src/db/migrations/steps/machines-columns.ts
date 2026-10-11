import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const machinesColumns: Migration = {
  name: "machines-columns",
  // A machines table can predate `machines` — a data root that ran the machines line
  // before it was released kept forwards, not sessions — and that migration's IF NOT
  // EXISTS adopted it whatever its columns were, so the first connect failed on the row's
  // insert. Adds what is missing, nullable; a platform rolled back to `machines` declared these
  // columns itself, so there is nothing for it to mind.
  swapSafe: true,
  up(db) {
    ensureColumn(db, "machines", "session_pid", "INTEGER");
    ensureColumn(db, "machines", "platform", "TEXT");
  },
  // Nothing to undo: what this added, `machines` already declares, and a column it found in place
  // was never this migration's to take away.
  down() {},
};
