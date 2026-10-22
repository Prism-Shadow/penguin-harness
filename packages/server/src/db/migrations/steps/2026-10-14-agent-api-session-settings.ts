import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const agentApiSessionSettings: Migration = {
  name: "2026-10-14-agent-api-session-settings",
  // The per-Agent API defaults a new Session starts with: which provider, model, thinking
  // level and workspace it opens in. Nullable additions preserve existing keys, exposure,
  // approvals and new-Session defaults.
  // Retain while a supported data root can predate these columns; the maintainer raising
  // that baseline removes this upgrade after all supported data roots have them.
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
