import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const machinesAdoptedAt: Migration = {
  name: "2026-10-16-machines-adopted-at",
  // When this server adopted a machine (first recorded it): the Sessions that machine held
  // before then read as CLI tasks through this server (session-sources.ts sourceSeenBy). A
  // machine recorded before this column has none and never gets one, so the rule does not apply
  // to it (user decision, 2026-10-15) — nothing on either side is rewritten. Swap-safe: a pushed platform boots against the runtime's
  // already-open database, so the column has to arrive by a migration.
  swapSafe: true,
  up(db) {
    ensureColumn(db, "machines", "adopted_at", "TEXT");
  },
  // Keep the adoption times on rollback; older builds ignore the column.
  down() {},
};
