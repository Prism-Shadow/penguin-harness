import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const usageRecordsThoughts: Migration = {
  name: "2026-11-19-usage-records-thoughts",
  // How many of a request's output tokens were thinking, where its usage reported that apart: a
  // model that bills thinking at its own rate (`pricing.thoughts`) is priced by it. Every existing
  // row is a chat turn's, a title's or a tool request recorded without it, which NULL says (its
  // output is priced at the output rate, as before), so nothing is rewritten. Swap-safe: a pushed
  // platform boots against the runtime's already-open database, and the predecessor never names
  // the column.
  swapSafe: true,
  up(db) {
    ensureColumn(db, "usage_records", "thoughts", "INTEGER");
  },
  // Not a DROP: schema.ts declares the column, and dropping it would reprice every request
  // recorded since at the output rate.
  down() {},
};
