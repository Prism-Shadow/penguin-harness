import { ensureColumn } from "../../database.js";
import type { Migration } from "../migration.js";

export const sessionPlanMode: Migration = {
  name: "2026-11-19-session-plan-mode",
  swapSafe: true,
  up(db) {
    ensureColumn(db, "sessions", "plan_mode", "INTEGER NOT NULL DEFAULT 0");
    // An early preview kept one row per enabled Session. Its proposal stays in the transcript.
    if (
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_plans'")
        .get()
    ) {
      db.exec(`UPDATE sessions SET plan_mode = 1 WHERE session_id IN (SELECT session_id FROM session_plans);
        CREATE TRIGGER IF NOT EXISTS rekey_preview_plan AFTER UPDATE OF session_id ON sessions
        BEGIN UPDATE session_plans SET session_id = NEW.session_id WHERE session_id = OLD.session_id; END;`);
    }
  },
  down() {},
};
