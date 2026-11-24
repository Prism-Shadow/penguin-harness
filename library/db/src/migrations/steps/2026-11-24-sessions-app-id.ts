import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const sessionsAppId: Migration = {
  name: "2026-11-24-sessions-app-id",
  // Canonical `<ownerAgentId>/<workbenchId>` of the App that opened a Session via
  // WorkbenchHost.createSession. Existing workbench rows stay NULL (unknown legacy app) and
  // older builds ignore the extra nullable column, so this is swap-safe.
  swapSafe: true,
  up(db) {
    ensureColumn(db, "sessions", "app_id", "TEXT");
  },
  // Not a DROP: schema.ts declares the column, and dropping it would erase app attribution.
  down() {},
};
