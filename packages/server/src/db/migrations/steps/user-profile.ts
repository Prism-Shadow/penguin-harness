import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const userProfile: Migration = {
  name: "user-profile",
  // Two nullable columns on `users`, no default and nothing existing rewritten: a platform
  // rolled back to a predecessor that does not know them never selects or writes them, and
  // every existing account simply reads NULL — no profile yet.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of the user-profile feature; do not re-derive from schema.ts.
    // SQLite has no ADD COLUMN IF NOT EXISTS, and the declarative track may already have
    // added both (RE-RUNNABLE in index.ts), so each one goes through the same table_info guard the
    // declarative track uses.
    ensureColumn(db, "users", "display_name", "TEXT");
    ensureColumn(db, "users", "avatar", "TEXT");
  },
  // LOSES every stored nickname and avatar: both live entirely in the two columns this
  // drops, and nothing else on disk holds a copy. Dropped in reverse order for symmetry
  // with `up`; neither column is indexed, which is what lets SQLite drop them at all.
  down(db) {
    const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    const has = (name: string): boolean => cols.some((c) => c.name === name);
    if (has("avatar")) db.exec("ALTER TABLE users DROP COLUMN avatar");
    if (has("display_name")) db.exec("ALTER TABLE users DROP COLUMN display_name");
  },
};
