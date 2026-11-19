import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const usageRecordsPurpose: Migration = {
  name: "2026-11-19-usage-records-purpose",
  // What a request outside a chat turn was for: a plugin's tool request (an image, a transcription)
  // is recorded beside the chat turns, and the Cost Center counts tokens of chat turns only. Every
  // existing row is a chat turn's or a title's, which NULL says, so nothing is rewritten. Swap-safe:
  // a pushed platform boots against the runtime's already-open database, and the predecessor never
  // names the column.
  swapSafe: true,
  up(db) {
    ensureColumn(db, "usage_records", "purpose", "TEXT");
  },
  // Not a DROP: schema.ts declares the column, and dropping it would file every tool request
  // recorded since as a chat turn.
  down() {},
};
