import type { Migration } from "../migration.js";

export const companyModeOrgCaches: Migration = {
  name: "company-mode-org-caches",
  // Additive: seven new tables for company mode (organizations of Agents), no change to any
  // existing table. Every row is either rebuildable from the organization's files (desks.toml,
  // the tickets' Sessions headers, the calendar files, usage records) or a user's own read
  // cursor; a predecessor build never touches them.
  swapSafe: true,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS org_sessions (      -- DERIVED CACHE (company mode): desk sessions, rebuilt from each organization's desks.toml (current + previous); trigger_hop is chat-chain accounting and reads 0 after a rebuild
        session_id  TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        org_id      TEXT NOT NULL,
        agent_id    TEXT NOT NULL,
        current     INTEGER NOT NULL DEFAULT 1,
        trigger_hop INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_org_sessions_org ON org_sessions(project_id, org_id);
      CREATE TABLE IF NOT EXISTS org_ticket_sessions ( -- DERIVED CACHE (company mode): ticket <-> contributing session, rebuilt from each ticket's Sessions header
        project_id  TEXT NOT NULL,
        org_id      TEXT NOT NULL,
        ticket_id   TEXT NOT NULL,
        session_id  TEXT NOT NULL,
        agent_id    TEXT NOT NULL,
        trigger_hop INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (project_id, org_id, ticket_id, session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_org_ticket_sessions_session ON org_ticket_sessions(session_id);
      CREATE TABLE IF NOT EXISTS org_calendar_state ( -- calendar run state (company mode; the files are declarative intent), same rules as schedule_state
        project_id     TEXT NOT NULL,
        org_id         TEXT NOT NULL,
        agent_id       TEXT NOT NULL,
        name           TEXT NOT NULL,
        start_at_ms    INTEGER NOT NULL,
        def_hash       TEXT NOT NULL,
        last_slot_ms   INTEGER,
        last_fired_at  TEXT,
        fired_once     INTEGER NOT NULL DEFAULT 0,
        missed         INTEGER NOT NULL DEFAULT 0,
        invalid_reason TEXT,
        last_outcome   TEXT,
        PRIMARY KEY (project_id, org_id, agent_id, name)
      );
      CREATE TABLE IF NOT EXISTS org_ticket_state (   -- DERIVED CACHE (company mode): the last (status, owner, blocked) seen per ticket, so a change is notified once; rebuilt silently from the ticket files
        project_id  TEXT NOT NULL,
        org_id      TEXT NOT NULL,
        ticket_id   TEXT NOT NULL,
        status      TEXT NOT NULL,
        owner       TEXT NOT NULL DEFAULT '',
        blocked     TEXT NOT NULL DEFAULT '',
        blocked_by  TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (project_id, org_id, ticket_id)
      );
      CREATE TABLE IF NOT EXISTS org_budget_state (   -- DERIVED CACHE (company mode): warn / pause marks per employee and period, recomputed from usage and the chart's budgets
        project_id TEXT NOT NULL,
        org_id     TEXT NOT NULL,
        agent_id   TEXT NOT NULL,
        period     TEXT NOT NULL,
        warned_at  TEXT,
        paused_at  TEXT,
        PRIMARY KEY (project_id, org_id, agent_id, period)
      );
    `);
    // The two chat tables company-mode-channels replaced. Re-running this migration after that
    // one (adoption runs every migration again) must not bring them back, so they are created
    // only while the channel tables that superseded them are absent.
    const superseded =
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'org_channel_state'")
        .get() !== undefined;
    if (!superseded) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS org_chat_state (     -- DERIVED CACHE (company mode): tail-scan byte cursor per chat day file
          project_id   TEXT NOT NULL,
          org_id       TEXT NOT NULL,
          date         TEXT NOT NULL,
          offset_bytes INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (project_id, org_id, date)
        );
        CREATE TABLE IF NOT EXISTS org_chat_reads (     -- user data (company mode): each user's read cursor in an organization's chat
          project_id   TEXT NOT NULL,
          org_id       TEXT NOT NULL,
          user_id      TEXT NOT NULL,
          last_read_id TEXT NOT NULL,
          PRIMARY KEY (project_id, org_id, user_id)
        );
      `);
    }
  },
  // Drops the seven tables. LOSES: chat read cursors (each user's "read up to here" marks) and
  // the run marks that stop a calendar slot, a ticket change or a budget alert from firing
  // twice — a build with this migration re-registers everything from the files, without
  // backfilling missed slots, and users see every chat message as unread once.
  down(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_org_ticket_sessions_session;
      DROP INDEX IF EXISTS idx_org_sessions_org;
      DROP TABLE IF EXISTS org_budget_state;
      DROP TABLE IF EXISTS org_chat_reads;
      DROP TABLE IF EXISTS org_chat_state;
      DROP TABLE IF EXISTS org_ticket_state;
      DROP TABLE IF EXISTS org_calendar_state;
      DROP TABLE IF EXISTS org_ticket_sessions;
      DROP TABLE IF EXISTS org_sessions;
    `);
  },
};
