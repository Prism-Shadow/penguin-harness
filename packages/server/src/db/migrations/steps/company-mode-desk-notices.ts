import type { Migration } from "../migration.js";

export const companyModeDeskNotices: Migration = {
  name: "company-mode-desk-notices",
  // Additive: one new table and its index. A ticket change no longer starts a work run at
  // the owner's desk; it is queued here and delivered inside the body of that employee's
  // next calendar sweep. A predecessor build never reads the table, so a rollback survives
  // it — with whatever rows are in it left undelivered.
  swapSafe: true,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS org_desk_notices (   -- DERIVED CACHE (company mode): ticket changes waiting for an employee's next calendar sweep; dropping it loses only the digests not delivered yet
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        org_id     TEXT NOT NULL,
        agent_id   TEXT NOT NULL,
        ticket_id  TEXT NOT NULL,
        change     TEXT NOT NULL,
        at         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_org_desk_notices_agent ON org_desk_notices(project_id, org_id, agent_id);
    `);
  },
  // LOSES every queued notice: the ticket changes an employee has not been told about yet.
  // The change itself is in the ticket file and its history either way; what
  // goes is the "Since your last sweep" line that would have named it.
  down(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_org_desk_notices_agent;
      DROP TABLE IF EXISTS org_desk_notices;
    `);
  },
};
