import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const agentApiSessionSettings: Migration = {
  name: "agent-api-session-settings",
  // Retain until the minimum supported root carries these columns; the maintainer raising
  // that baseline removes this upgrade. Nullable additions preserve existing keys, exposure,
  // approvals and new-Session defaults.
  swapSafe: true,
  up(db) {
    ensureColumn(db, "agent_api", "provider", "TEXT");
    ensureColumn(db, "agent_api", "model_id", "TEXT");
    ensureColumn(db, "agent_api", "thinking_level", "TEXT");
    ensureColumn(db, "agent_api", "workspace", "TEXT");
  },
  // Keep the saved defaults on rollback; older builds ignore the additional columns.
  down() {},
};
