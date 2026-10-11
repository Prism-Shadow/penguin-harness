import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const agentApiConcurrency: Migration = {
  name: "agent-api-concurrency",
  // Retain until the minimum supported root carries the column; the maintainer raising that
  // baseline removes this upgrade once every supported data root has it.
  swapSafe: true,
  up(db) {
    ensureColumn(db, "agent_api", "max_concurrent_runs", "INTEGER NOT NULL DEFAULT 4");
  },
  // Keep the configured limit on rollback; older builds ignore this column.
  down() {},
};
