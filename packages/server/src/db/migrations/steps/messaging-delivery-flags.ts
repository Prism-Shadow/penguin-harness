import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const messagingDeliveryFlags: Migration = {
  name: "messaging-delivery-flags",
  // Two columns with defaults on an existing table: a rollback to a predecessor that
  // does not know them leaves them at their defaults and reads nothing.
  swapSafe: true,
  up(db) {
    // 0.2.7 → 0.2.8. ensureColumn rather than a bare ALTER because the declarative
    // track may already have added these (see RE-RUNNABLE in index.ts).
    ensureColumn(db, "messaging_bindings", "final_reply_only", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "messaging_bindings", "render_markdown", "INTEGER NOT NULL DEFAULT 1");
  },
  // LOSES both delivery preferences on every binding; the bindings themselves survive.
  // Dropped in reverse order for symmetry with `up`. Neither column is indexed, which is
  // what lets SQLite drop them at all.
  down(db) {
    db.exec("ALTER TABLE messaging_bindings DROP COLUMN render_markdown");
    db.exec("ALTER TABLE messaging_bindings DROP COLUMN final_reply_only");
  },
};
