import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const sessionsKeptAt: Migration = {
  name: "2026-10-12-sessions-kept-at",
  // The "keep in sidebar" mark: written when the user unarchives a Session, cleared when they
  // archive it. The listing rule files a background Session (api / schedule / cli) away unless
  // it carries the mark, so existing rows are listed by the rule as they stand and nothing is
  // rewritten. Swap-safe: a pushed platform boots against the runtime's already-open database,
  // so the column has to arrive by a migration.
  swapSafe: true,
  up(db) {
    ensureColumn(db, "sessions", "kept_at", "TEXT");
  },
  // Not a DROP: schema.ts declares the column, and dropping it would file every kept
  // background Session away again.
  down() {},
};
