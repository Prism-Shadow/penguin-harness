import type { Migration } from "../migration.js";

export const companyModeDeskMentions: Migration = {
  name: "2026-09-21-company-mode-desk-mentions",
  // Additive: one new table. A channel mention no longer starts a Task of its own (queued in
  // the session's in-memory follow-ups when the desk is busy); it waits here until the desk
  // is idle and is delivered with the others in one run. A predecessor build never reads the
  // table, so a rollback survives it — with whatever rows are in it left undelivered.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of this migration; do not re-derive from schema.ts.
    db.exec(`
      CREATE TABLE IF NOT EXISTS org_desk_mentions (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        org_id     TEXT NOT NULL,
        agent_id   TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        date       TEXT NOT NULL,
        message_id TEXT NOT NULL,
        hop        INTEGER NOT NULL,
        UNIQUE (project_id, org_id, agent_id, channel_id, message_id)
      );
    `);
  },
  // LOSES every mention not delivered yet: the message stays in its channel file, but no
  // desk run will name it.
  down(db) {
    db.exec(`DROP TABLE IF EXISTS org_desk_mentions;`);
  },
};
