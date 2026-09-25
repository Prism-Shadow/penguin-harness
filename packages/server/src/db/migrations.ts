/**
 * Ordered, versioned schema migrations.
 *
 * `schema.ts` declares the shape a FRESH database is created with. It cannot express a
 * CHANGE — `CREATE TABLE IF NOT EXISTS` only ever says "should exist", so re-running it
 * converges a database toward the current declaration without ever knowing, or recording,
 * which state it came from. That is why a build could not tell a 0.2.4 database from a
 * 0.2.7 one, and why the only safe change was an additive one.
 *
 * A migration says what CHANGED, runs once, and leaves the database stamped with how far
 * it has come (`PRAGMA user_version`). Two rules make that stamp trustworthy:
 *
 * FROZEN DDL. A migration spells out its own SQL and never imports SCHEMA_SQL. Referring
 * to the live declaration would make an old migration silently mean something new every
 * time the schema moves, which is the property that makes migrations auditable at all.
 *
 * ONE WAY, IN ORDER. Versions are contiguous from 1 and never renumbered or rewritten
 * once released — a database that already stamped version N will never run N again, so
 * editing N only changes what NEW databases get, and silently forks the two.
 *
 * `swapSafe` is this codebase's extra axis, and it exists because of hot updates. A
 * pushed platform boots against a live database and is ROLLED BACK to its predecessor if
 * it fails; the predecessor then runs on whatever the migration already did. Additive
 * work survives that (the older build does not know the new table, so it never touches
 * it) — narrowing work does not. Anything that drops, retypes, constrains, or reshapes
 * is `swapSafe: false` and must be refused on the swap path rather than half-applied
 * (see `migrate`'s `swapPath` option).
 *
 * DOWN, AND WHO DOES NOT CALL IT. Every migration declares an undo — or declares `null`
 * to say it has none, which is a decision the author has to make rather than omit. What
 * `down` is NOT is the hot-update rollback mechanism. When a pushed platform fails to boot
 * the runtime reverts to its PREDECESSOR and the schema stays where the migration left it:
 * undoing DDL inside a process whose boot just failed would run destructive statements
 * against a half-known state, and `swapSafe` exists precisely so that not undoing is safe —
 * the predecessor does not know the new table or column, so it never touches it. `down` is
 * an operator's tool, called deliberately (`rollbackTo`), never by the swap.
 *
 * It is also LOSSY by nature: undoing "add a table" drops that table with its rows in it.
 * Each `down` below names what its rows were.
 *
 * ADOPTION. Databases created before this file existed are all stamped 0 while sitting in
 * genuinely different shapes, so a migration must tolerate finding its work already done.
 * That is not only a version-1 concern: `schema.ts` still DECLARES the current shape in
 * full and `openDatabase` still runs its ensureColumn list, so a database can arrive at a
 * migration with that migration's work already applied by the declarative track. Until
 * SCHEMA_SQL is frozen to a baseline and every later change is a migration, every
 * migration here stays idempotent — `IF NOT EXISTS`, or the same `ensureColumn` guard the
 * declarative track uses. Once that double track is gone, a bare `CREATE TABLE` that
 * fails loudly becomes the point.
 */
import type { DatabaseSync } from "node:sqlite";
import { ensureColumn } from "./database.js";

export interface Migration {
  /** Contiguous from 1. Never renumbered, never edited once released. */
  version: number;
  /** Kebab-case, names the change — read in logs and in the stamp's history. */
  name: string;
  /**
   * May this run while a pushed platform boots? True only for strictly additive work,
   * which a rollback to the previous platform survives. See the module doc.
   */
  swapSafe: boolean;
  /** Applied inside a transaction; throw to abort and leave the version unchanged. */
  up: (db: DatabaseSync) => void;
  /**
   * Undoes `up`, or null when this migration cannot be undone — required, not optional, so
   * "there is no undo" is something the author states rather than forgets.
   *
   * Never called by the swap path (see the module doc): a failed boot reverts the platform,
   * not the schema. Reached only through `rollbackTo`, and destructive by nature — dropping
   * a table takes its rows with it.
   */
  down: ((db: DatabaseSync) => void) | null;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "messaging-bindings",
    // Purely additive: one new table plus three indexes, no column of any existing table
    // touched. A platform that rolls back to a predecessor without messaging simply never
    // queries them.
    swapSafe: true,
    up(db) {
      // 0.2.4 → 0.2.7. Frozen copy of the DDL as of 0.2.7; do not re-derive from schema.ts.
      // IF NOT EXISTS only because version 1 adopts unstamped databases, which may already
      // be at 0.2.7 (see the module doc's ADOPTION note).
      db.exec(`
        CREATE TABLE IF NOT EXISTS messaging_bindings (
          session_id       TEXT NOT NULL,
          channel          TEXT NOT NULL,
          account_id       TEXT NOT NULL,
          config_json      TEXT NOT NULL,
          enabled          INTEGER NOT NULL DEFAULT 0,
          line_per_message INTEGER NOT NULL DEFAULT 0,
          last_chat_id     TEXT,
          last_chat_is_direct INTEGER NOT NULL DEFAULT 1,
          last_inbound_message_id TEXT,
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL,
          PRIMARY KEY (session_id, channel)
        );
        CREATE INDEX IF NOT EXISTS idx_messaging_by_account ON messaging_bindings(channel, account_id);
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
      `);
    },
    // LOSES every messaging binding: the channel credentials, the enabled flag and the
    // last-chat memory all live in the table this drops. The auth_sessions indexes are
    // derived and cost nothing to lose.
    down(db) {
      db.exec(`
        DROP INDEX IF EXISTS idx_auth_sessions_user;
        DROP INDEX IF EXISTS idx_auth_sessions_expires;
        DROP INDEX IF EXISTS idx_messaging_by_account;
        DROP TABLE IF EXISTS messaging_bindings;
      `);
    },
  },
  {
    version: 2,
    name: "messaging-delivery-flags",
    // Two columns with defaults on an existing table: a rollback to a predecessor that
    // does not know them leaves them at their defaults and reads nothing.
    swapSafe: true,
    up(db) {
      // 0.2.7 → 0.2.8. ensureColumn rather than a bare ALTER because the declarative
      // track may already have added these (see the module doc's ADOPTION note).
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
  },
  {
    version: 3,
    name: "drop-goal-state",
    // Narrowing: drops a table. A pushed platform rolled back to 0.2.9 mid-process would
    // prepare its goal statements against a table that is gone (its declarative track only
    // runs at the runtime's own open, never at a platform boot), so this is the first
    // restart-only migration: refused on the swap path, applied by the runtime's open.
    swapSafe: false,
    up(db) {
      // 0.2.9 → 0.2.10. goal_state held goal mode's run state, one row per goal run, read
      // back only for the chat page's goal banner; the goal plugin's GOAL.json in the
      // Session scratchpad is that record now (see runtime/goal-events.ts). IF EXISTS only
      // because a database this build created never had the table.
      db.exec(`
        DROP INDEX IF EXISTS idx_goal_session;
        DROP TABLE IF EXISTS goal_state;
      `);
    },
    // Recreates the table exactly as 0.2.9 declared it — EMPTY. LOSES every goal run ever
    // recorded (objective, status, budget, used, rounds per run): the rows only ever fed the
    // banner of a finished goal, and a build with this migration reads the goal file instead.
    down(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS goal_state (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id  TEXT NOT NULL,
          project_id  TEXT NOT NULL,
          agent_id    TEXT NOT NULL,
          objective   TEXT NOT NULL,
          status      TEXT NOT NULL,
          budget      INTEGER NOT NULL,
          used        INTEGER NOT NULL DEFAULT 0,
          rounds      INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_goal_session ON goal_state(session_id);
      `);
    },
  },
  {
    version: 4,
    name: "machines",
    // Three new tables, nothing existing touched: a platform rolled back to one without
    // machines never queries them. Swap-safe on its own; a database still behind
    // drop-goal-state is refused whole by that one first, which is the rule.
    swapSafe: true,
    up(db) {
      // Frozen copy of the DDL as of the machines feature; do not re-derive from schema.ts.
      // IF NOT EXISTS because the declarative track may already have created them (ADOPTION).
      db.exec(`
        CREATE TABLE IF NOT EXISTS machine (
          singleton  INTEGER PRIMARY KEY CHECK (singleton = 1),
          machine_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS machines (
          address      TEXT PRIMARY KEY,
          machine_id   TEXT,
          version      TEXT,
          installed_at TEXT,
          session_pid  INTEGER,
          remote_port  INTEGER,
          platform     TEXT
        );
        CREATE TABLE IF NOT EXISTS machine_project (
          project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
          addresses  TEXT NOT NULL
        );
      `);
    },
    // LOSES this server's own machine id (every stored reference to it on other machines
    // then points at nothing), what was installed where, the sessions held, and which
    // machines each Project used.
    down(db) {
      db.exec(`
        DROP TABLE IF EXISTS machine_project;
        DROP TABLE IF EXISTS machines;
        DROP TABLE IF EXISTS machine;
      `);
    },
  },
  {
    version: 5,
    name: "user-profile",
    // Two nullable columns on `users`, no default and nothing existing rewritten: a platform
    // rolled back to a predecessor that does not know them never selects or writes them, and
    // every existing account simply reads NULL — no profile yet.
    swapSafe: true,
    up(db) {
      // Frozen copy of the DDL as of the user-profile feature; do not re-derive from schema.ts.
      // SQLite has no ADD COLUMN IF NOT EXISTS, and the declarative track may already have
      // added both (ADOPTION), so each one goes through the same table_info guard the
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
  },
  {
    version: 6,
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
  },
  {
    version: 7,
    name: "company-mode-channels",
    // The organization's single group chat became channels: a message lives in
    // `channels/<channel_id>/<date>.jsonl`, so the tail-scan cursor and each user's read
    // cursor are per channel. `org_chat_state` / `org_chat_reads` are dropped for
    // `org_channel_state` / `org_channel_reads`: the tables are renamed and the channel
    // belongs in the primary key, neither of which SQLite does in place. Nothing is carried
    // over: company mode is unreleased, and every row was either rebuildable from the files
    // (the scan cursor) or one pass of "everything looks unread" (the read cursor). A
    // predecessor build reads neither table's shape, only its own writes, so this is
    // swap-safe.
    swapSafe: true,
    up(db) {
      db.exec(`
        DROP TABLE IF EXISTS org_chat_state;
        DROP TABLE IF EXISTS org_chat_reads;
        CREATE TABLE IF NOT EXISTS org_channel_state ( -- DERIVED CACHE (company mode): tail-scan byte cursor per channel and day file
          project_id   TEXT NOT NULL,
          org_id       TEXT NOT NULL,
          channel_id   TEXT NOT NULL,
          date         TEXT NOT NULL,
          offset_bytes INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (project_id, org_id, channel_id, date)
        );
        CREATE TABLE IF NOT EXISTS org_channel_reads ( -- user data (company mode): each user's read cursor in one channel
          project_id   TEXT NOT NULL,
          org_id       TEXT NOT NULL,
          channel_id   TEXT NOT NULL,
          user_id      TEXT NOT NULL,
          last_read_id TEXT NOT NULL,
          PRIMARY KEY (project_id, org_id, channel_id, user_id)
        );
      `);
    },
    // Recreates the two tables under their old names, exactly as migration 6 declared them —
    // EMPTY. LOSES every scan cursor (re-derived by the next pass, which republishes the
    // messages it re-reads) and every read cursor (users see the recent days as unread once).
    down(db) {
      db.exec(`
        DROP TABLE IF EXISTS org_channel_state;
        DROP TABLE IF EXISTS org_channel_reads;
        CREATE TABLE IF NOT EXISTS org_chat_state (     -- DERIVED CACHE (company mode): tail-scan byte cursor per chat day file
          project_id   TEXT NOT NULL,
          org_id       TEXT NOT NULL,
          date         TEXT NOT NULL,
          offset_bytes INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (project_id, org_id, date)
        );
        CREATE TABLE IF NOT EXISTS org_chat_reads ( -- user data (company mode): each user's read cursor in an organization's chat
          project_id   TEXT NOT NULL,
          org_id       TEXT NOT NULL,
          user_id      TEXT NOT NULL,
          last_read_id TEXT NOT NULL,
          PRIMARY KEY (project_id, org_id, user_id)
        );
      `);
    },
  },
  {
    version: 8,
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
  },
  {
    version: 9,
    name: "model-promotions",
    // Additive: one new table, nothing existing touched. A predecessor build never reads it
    // and prices every row at the number in its Project file, so a rollback survives it.
    swapSafe: true,
    up(db) {
      // Frozen copy of the DDL as of the model-promotions feature; do not re-derive from
      // schema.ts. IF NOT EXISTS because the declarative track may already have created it
      // (ADOPTION).
      db.exec(`
        CREATE TABLE IF NOT EXISTS model_promotions ( -- NOT a cache rebuildable from files: the only record of a Project row's running promotion (.project_config.toml keeps the list price), written by preset seeding at Project creation, "sync presets" and Penguin Go authorization / sync, and read by cost; lost rows price usage at list until the next sync writes them back
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          provider   TEXT NOT NULL,
          model_id   TEXT NOT NULL,
          discount   REAL NOT NULL CHECK (discount > 0 AND discount < 1),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (project_id, provider, model_id)
        );
      `);
    },
    // LOSES every stored promotion: no file holds a copy of the fractions, so usage is priced
    // at the Project files' list prices until the next "sync presets" or Penguin Go sync
    // writes them back.
    down(db) {
      db.exec("DROP TABLE IF EXISTS model_promotions");
    },
  },
  {
    version: 10,
    name: "activity-authoring-foundation",
    swapSafe: true,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS activity_collections (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          collection_id TEXT NOT NULL,
          path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (project_id, collection_id)
        );
        CREATE TABLE IF NOT EXISTS activities (
          id TEXT PRIMARY KEY,
          collection_id TEXT NOT NULL,
          product_code TEXT NOT NULL,
          ref_num INTEGER NOT NULL CHECK (ref_num >= 0),
          title TEXT NOT NULL,
          activity_type TEXT NOT NULL CHECK (activity_type IN ('standard', 'book')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
          UNIQUE (collection_id, product_code, ref_num)
        );
        CREATE INDEX IF NOT EXISTS idx_activities_collection ON activities(collection_id, archived, updated_at);
        CREATE TABLE IF NOT EXISTS activity_drafts (
          draft_id TEXT PRIMARY KEY,
          activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
          base_version_id TEXT,
          content_revision TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('draft', 'valid', 'invalid')),
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_activity_drafts_activity ON activity_drafts(activity_id, updated_at);
      `);
    },
    down(db) {
      db.exec(
        "DROP TABLE IF EXISTS activity_drafts; DROP TABLE IF EXISTS activities; DROP TABLE IF EXISTS activity_collections;",
      );
    },
  },
  {
    version: 11,
    name: "activity-generation-runs",
    swapSafe: true,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS activity_runs (
          run_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          record_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_activity_runs_activity ON activity_runs(project_id, activity_id, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_runs_active ON activity_runs(activity_id) WHERE status = 'running';
      `);
    },
    // LOSES generation history and candidate copies in SQLite. Isolated run files
    // remain on disk, but are not enough to reconstruct every terminal outcome.
    down(db) {
      db.exec("DROP TABLE IF EXISTS activity_runs");
    },
  },
  {
    version: 12,
    name: "activity-candidate-storage",
    // Old writers embed candidate bytes in record_json, so upgrade at a restart boundary.
    // Maintainers retain this one-time conversion and rollback with migration history;
    // retire it only when the minimum supported schema no longer permits version 11.
    swapSafe: false,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS activity_run_candidates (
          run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE,
          candidate TEXT NOT NULL
        );
        INSERT INTO activity_run_candidates (run_id, candidate)
          SELECT run_id, json_extract(record_json, '$.candidate') FROM activity_runs
          WHERE json_type(record_json, '$.candidate') = 'text'
          ON CONFLICT(run_id) DO UPDATE SET candidate = excluded.candidate;
        UPDATE activity_runs SET record_json = json_set(json_remove(record_json, '$.candidate'),
          '$.hasCandidate', json(CASE WHEN EXISTS(SELECT 1 FROM activity_run_candidates c WHERE c.run_id = activity_runs.run_id) THEN 'true' ELSE 'false' END));
      `);
    },
    down(db) {
      db.exec(`
        UPDATE activity_runs SET record_json = json_set(json_remove(record_json, '$.hasCandidate'),
          '$.candidate', (SELECT candidate FROM activity_run_candidates c WHERE c.run_id = activity_runs.run_id));
        DROP TABLE activity_run_candidates;
      `);
    },
  },
  {
    version: 13,
    name: "activity-module-runs",
    // Older generation services cannot collect module output. Restart before admitting it.
    // Maintainers retain this migration until schemas below 13 leave the supported range.
    swapSafe: false,
    up(db) {
      db.exec(
        "CREATE TABLE IF NOT EXISTS activity_module_runs (run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE)",
      );
    },
    down(db) {
      // Refuse to relabel assembly attempts as specification attempts during downgrade.
      const row = db.prepare("SELECT COUNT(*) AS count FROM activity_module_runs").get() as {
        count: number;
      };
      if (row.count)
        throw new Error("Cannot remove module run storage while assembly attempts exist.");
      db.exec("DROP TABLE activity_module_runs");
    },
  },
  {
    version: 14,
    name: "activity-audio-runs",
    // Restart prevents old collectors interpreting speech output as specification output.
    // Maintainers retain the migration until schema versions below 14 leave support.
    swapSafe: false,
    up(db) {
      db.exec(
        "CREATE TABLE IF NOT EXISTS activity_audio_runs (run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE)",
      );
    },
    down(db) {
      const row = db.prepare("SELECT COUNT(*) AS count FROM activity_audio_runs").get() as {
        count: number;
      };
      if (row.count)
        throw new Error("Cannot remove audio run storage while speech attempts exist.");
      db.exec("DROP TABLE activity_audio_runs");
    },
  },
  {
    version: 15,
    name: "activity-image-runs",
    // Old collectors cannot interpret image candidates. Retain until schema <15 leaves support.
    swapSafe: false,
    up(db) {
      db.exec(
        "CREATE TABLE IF NOT EXISTS activity_image_runs (run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE)",
      );
    },
    down(db) {
      const row = db.prepare("SELECT COUNT(*) AS count FROM activity_image_runs").get() as {
        count: number;
      };
      if (row.count) throw new Error("Cannot remove image run storage while image attempts exist.");
      db.exec("DROP TABLE activity_image_runs");
    },
  },
  {
    version: 16,
    name: "activity-media-text-runs",
    // Restart-only: older collectors do not know how to classify media-text attempts.
    swapSafe: false,
    up(db) {
      db.exec(
        "CREATE TABLE IF NOT EXISTS activity_media_text_runs (run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE)",
      );
    },
    down(db) {
      const row = db.prepare("SELECT COUNT(*) AS count FROM activity_media_text_runs").get() as {
        count: number;
      };
      if (row.count)
        throw new Error("Cannot remove media text run storage while media text attempts exist.");
      db.exec("DROP TABLE activity_media_text_runs");
    },
  },
  {
    version: 17,
    name: "activity-run-kind-column",
    // Restart-only: a running collector derives a run's kind by probing the marker
    // tables this migration drops, and would read every surviving run as a spec run.
    swapSafe: false,
    up(db) {
      // The four marker tables answered one question -- what kind of run is this --
      // with one table per answer, which held for five kinds and does not hold for the
      // dozen the generation pipeline adds. A column answers it once.
      //
      // A fresh database gets the column from schema.ts and then replays every
      // migration, so adding it has to be conditional the way CREATE TABLE IF NOT
      // EXISTS is for the rest of this file.
      const columns = db.prepare("PRAGMA table_info(activity_runs)").all() as { name: string }[];
      if (!columns.some((column) => column.name === "kind"))
        db.exec("ALTER TABLE activity_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'spec'");
      // Each marker table may already be gone on a fresh database; carrying the runs
      // across only matters where one survives.
      for (const [table, kind] of [
        ["activity_media_text_runs", "media-text"],
        ["activity_image_runs", "image"],
        ["activity_audio_runs", "audio"],
        ["activity_module_runs", "module"],
      ] as const) {
        const present = db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table);
        if (!present) continue;
        db.exec(
          `UPDATE activity_runs SET kind = '${kind}' WHERE run_id IN (SELECT run_id FROM ${table});`,
        );
        db.exec(`DROP TABLE ${table};`);
      }
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_activity_runs_kind ON activity_runs(activity_id, kind)",
      );
    },
    down(db) {
      // Reversible only while every run still holds one of the five kinds the marker
      // tables could express; a newer stage kind has nowhere to go and says so rather
      // than being silently demoted to a spec run.
      const stray = db
        .prepare(
          "SELECT DISTINCT kind FROM activity_runs WHERE kind NOT IN ('spec','module','audio','image','media-text')",
        )
        .all() as { kind: string }[];
      if (stray.length)
        throw new Error(
          `Cannot restore per-kind run tables: ${stray
            .map((row) => row.kind)
            .join(", ")} has no table to go back to.`,
        );
      db.exec(`
        CREATE TABLE IF NOT EXISTS activity_module_runs (
          run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS activity_audio_runs (
          run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS activity_image_runs (
          run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS activity_media_text_runs (
          run_id TEXT PRIMARY KEY REFERENCES activity_runs(run_id) ON DELETE CASCADE);
        INSERT INTO activity_module_runs (run_id) SELECT run_id FROM activity_runs WHERE kind = 'module';
        INSERT INTO activity_audio_runs (run_id) SELECT run_id FROM activity_runs WHERE kind = 'audio';
        INSERT INTO activity_image_runs (run_id) SELECT run_id FROM activity_runs WHERE kind = 'image';
        INSERT INTO activity_media_text_runs (run_id) SELECT run_id FROM activity_runs WHERE kind = 'media-text';
        DROP INDEX IF EXISTS idx_activity_runs_kind;
        ALTER TABLE activity_runs DROP COLUMN kind;
      `);
    },
  },
  {
    version: 18,
    name: "activity-product-level",
    // Restart-only: an older writer creates activities with no product parent, and the
    // canonical-ref rule three generation stages depend on cannot be answered for them.
    swapSafe: false,
    up(db) {
      // Loom nests refs under a product that owns the module code, with one ref canonical.
      // Penguin had (productCode, refNum) flattened into one row and so could not say which
      // ref was canonical. This gives the product somewhere to live.
      db.exec(`
        CREATE TABLE IF NOT EXISTS activity_products (
          product_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          collection_id TEXT NOT NULL,
          product_code TEXT NOT NULL,
          module_folder TEXT NOT NULL,
          canonical_ref_num INTEGER,
          activity_type TEXT NOT NULL CHECK (activity_type IN ('standard', 'book')),
          book_mode TEXT CHECK (book_mode IN ('decodable', 'readAlong')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (collection_id, product_code)
        );
        CREATE INDEX IF NOT EXISTS idx_activity_products_collection
          ON activity_products(collection_id, product_code);
      `);
      const columns = db.prepare("PRAGMA table_info(activities)").all() as { name: string }[];
      const has = (name: string) => columns.some((column) => column.name === name);
      if (!has("product_id"))
        db.exec(
          "ALTER TABLE activities ADD COLUMN product_id TEXT REFERENCES activity_products(product_id) ON DELETE CASCADE",
        );
      if (!has("display_name")) db.exec("ALTER TABLE activities ADD COLUMN display_name TEXT");
      if (!has("stable"))
        db.exec(
          "ALTER TABLE activities ADD COLUMN stable INTEGER NOT NULL DEFAULT 0 CHECK (stable IN (0, 1))",
        );
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_activities_product ON activities(product_id, ref_num)",
      );

      // One product per (collection, product code) that already has refs. The lowest ref
      // number becomes canonical and supplies the type: existing rows carry no opinion about
      // which ref owns the module, and the first one made is the least surprising answer.
      const groups = db
        .prepare(
          `SELECT collection_id AS collectionId, product_code AS productCode,
                  MIN(ref_num) AS canonical, MIN(created_at) AS createdAt
             FROM activities WHERE product_id IS NULL
            GROUP BY collection_id, product_code`,
        )
        .all() as {
        collectionId: string;
        productCode: string;
        canonical: number;
        createdAt: string;
      }[];
      const now = new Date().toISOString();
      for (const group of groups) {
        const project = db
          .prepare(
            "SELECT project_id AS projectId FROM activity_collections WHERE collection_id = ?",
          )
          .get(group.collectionId) as { projectId: string } | undefined;
        // A collection with no row is already unreachable; leaving its activities without a
        // product keeps this migration total rather than inventing a project for them.
        if (!project) continue;
        const canonical = db
          .prepare(
            "SELECT activity_type AS activityType FROM activities WHERE collection_id = ? AND product_code = ? AND ref_num = ?",
          )
          .get(group.collectionId, group.productCode, group.canonical) as
          { activityType: string } | undefined;
        const productId = `prd_${group.collectionId}_${group.productCode}`.replace(
          /[^A-Za-z0-9_]/g,
          "_",
        );
        db.prepare(
          `INSERT INTO activity_products
             (product_id, project_id, collection_id, product_code, module_folder,
              canonical_ref_num, activity_type, book_mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
           ON CONFLICT(collection_id, product_code) DO NOTHING`,
        ).run(
          productId,
          project.projectId,
          group.collectionId,
          group.productCode,
          `waf-module-${group.productCode}`,
          group.canonical,
          canonical?.activityType ?? "standard",
          group.createdAt ?? now,
          now,
        );
        db.prepare(
          `UPDATE activities SET product_id =
             (SELECT product_id FROM activity_products WHERE collection_id = ? AND product_code = ?)
            WHERE collection_id = ? AND product_code = ?`,
        ).run(group.collectionId, group.productCode, group.collectionId, group.productCode);
      }
    },
    down(db) {
      // Ref rows keep their product code, so this loses only the canonical marker, the
      // module folder, and each ref's name and stability.
      db.exec(`
        DROP INDEX IF EXISTS idx_activities_product;
        ALTER TABLE activities DROP COLUMN stable;
        ALTER TABLE activities DROP COLUMN display_name;
        ALTER TABLE activities DROP COLUMN product_id;
        DROP INDEX IF EXISTS idx_activity_products_collection;
        DROP TABLE IF EXISTS activity_products;
      `);
    },
  },
  {
    version: 19,
    name: "usage-reported-cost",
    // Swap-safe: the column is nullable, so an older writer's inserts simply leave it empty,
    // and an older reader never selects it.
    swapSafe: true,
    up(db) {
      // Cost is computed from the Project's pricing at read time and never stored. A coding
      // agent is the exception: it prices its own work and reports what a turn cost, and no
      // Project pricing exists for it, so that figure is kept on the record. NULL means the
      // runner reported no cost, which is every core Session's record.
      const columns = db.prepare("PRAGMA table_info(usage_records)").all() as { name: string }[];
      if (!columns.some((column) => column.name === "reported_cost_usd"))
        db.exec("ALTER TABLE usage_records ADD COLUMN reported_cost_usd REAL");
    },
    down(db) {
      // Loses only the costs coding agents reported; their tokens stay.
      db.exec("ALTER TABLE usage_records DROP COLUMN reported_cost_usd");
    },
  },
  {
    version: 20,
    name: "activity-product-tags",
    // Swap-safe: a new table no older reader or writer knows about, so either build runs
    // against it unchanged.
    swapSafe: true,
    up(db) {
      // Free-text labels an author gives a product ("grade 1", "phonics"); every ref of the
      // product shares them. Position keeps the order the author typed them in.
      db.exec(`
        CREATE TABLE IF NOT EXISTS activity_product_tags (
          product_id TEXT NOT NULL REFERENCES activity_products(product_id) ON DELETE CASCADE,
          tag TEXT NOT NULL,
          position INTEGER NOT NULL,
          PRIMARY KEY (product_id, tag)
        );
      `);
    },
    down(db) {
      // Loses only the tags; products and refs are untouched.
      db.exec("DROP TABLE IF EXISTS activity_product_tags");
    },
  },
  {
    version: 21,
    name: "activity-versions",
    // Swap-safe: a new table no older reader or writer knows about, so either build runs
    // against it unchanged.
    swapSafe: true,
    up(db) {
      // An author's saved versions of an activity. The row says what and when; the content
      // (the version manifest and the media bytes) lives in content-addressed blobs under the
      // activity's own directory, so a file every version shares is stored once.
      db.exec(`
          CREATE TABLE IF NOT EXISTS activity_versions (
          version_id TEXT PRIMARY KEY,
          activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          label TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('manual', 'auto', 'restore', 'deploy')),
          -- Why an automatic version was kept: 'before_restore' or 'before_proposal'.
          reason TEXT,
          -- SHA-256 of the canonical version manifest, which is also the manifest blob's name.
          content_hash TEXT NOT NULL,
          manifest_sha TEXT NOT NULL,
          media_bytes INTEGER NOT NULL,
          module_run_id TEXT,
          source_version_id TEXT,
          author_user_id TEXT,
          deployed_qa_at TEXT,
          deployed_prod_at TEXT,
          created_at TEXT NOT NULL,
          UNIQUE (activity_id, seq)
          );
          CREATE INDEX IF NOT EXISTS idx_activity_versions_activity ON activity_versions(activity_id, seq);
      `);
    },
    down(db) {
      // Loses the version history. The blobs stay on disk, where nothing reads them.
      db.exec("DROP INDEX IF EXISTS idx_activity_versions_activity");
      db.exec("DROP TABLE IF EXISTS activity_versions");
    },
  },
  {
    version: 22,
    name: "activity-versions-draft-status",
    // Swap-safe: the column is nullable, so an older writer's inserts leave it empty and an
    // older reader never selects it.
    swapSafe: true,
    up(db) {
      // The draft's status when the version was kept. It is not content, so it stays out of
      // the version's hash, but a restore needs it: a script edited after its specification
      // leaves the draft "draft", and that must survive a restore. NULL (older rows) means
      // the status is worked out from the specification.
      const columns = db.prepare("PRAGMA table_info(activity_versions)").all() as {
        name: string;
      }[];
      if (!columns.some((column) => column.name === "draft_status"))
        db.exec("ALTER TABLE activity_versions ADD COLUMN draft_status TEXT");
    },
    down(db) {
      // Loses only the kept statuses; a restore then works them out from the specification.
      db.exec("ALTER TABLE activity_versions DROP COLUMN draft_status");
    },
  },
];

/** The highest version this build knows how to reach. */
export const LATEST_VERSION: number = MIGRATIONS.reduce((n, m) => Math.max(n, m.version), 0);

/** How far this database has been migrated. Unstamped (pre-migrations) databases read 0. */
export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

export class IrreversibleMigrationError extends Error {
  constructor(readonly migration: Migration) {
    super(
      `migration ${migration.version} (${migration.name}) declares no down and cannot be rolled back. ` +
        `Restore the database from a backup taken before it was applied.`,
    );
    this.name = "IrreversibleMigrationError";
  }
}

export class RestartRequiredError extends Error {
  constructor(readonly migration: Migration) {
    super(
      `migration ${migration.version} (${migration.name}) is restart-only and cannot be applied ` +
        `while a pushed platform boots: it is not safe to leave behind if this boot is rolled back. ` +
        `Restart the runtime on a build that carries it, then push again.`,
    );
    this.name = "RestartRequiredError";
  }
}

/**
 * Applies every migration this database has not reached yet, in order.
 *
 * Each migration and its version stamp commit together, so an interrupted run leaves the
 * database at the last version that fully applied — never half-migrated. Already-current
 * databases do no work and touch nothing.
 *
 * `swapPath` marks the caller as a booting pushed platform: the first pending migration
 * that is not `swapSafe` throws RestartRequiredError BEFORE anything is applied, so the
 * push is refused whole rather than partially landed.
 */
export function migrate(
  db: DatabaseSync,
  { swapPath = false }: { swapPath?: boolean } = {},
): { from: number; to: number; applied: readonly string[] } {
  const from = schemaVersion(db);
  const pending = [...MIGRATIONS]
    .sort((a, b) => a.version - b.version)
    .filter((m) => m.version > from);
  if (swapPath) {
    const blocked = pending.find((m) => !m.swapSafe);
    if (blocked) throw new RestartRequiredError(blocked);
  }
  const applied: string[] = [];
  for (const m of pending) {
    db.exec("BEGIN");
    try {
      m.up(db);
      // PRAGMA takes no bound parameter; the value is this file's own integer literal.
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${m.version} (${m.name}) failed: ${String(err)}`, { cause: err });
    }
    applied.push(m.name);
  }
  return { from, to: schemaVersion(db), applied };
}

/**
 * Reverts the database DOWN to `targetVersion`, newest migration first.
 *
 * An operator's tool, and a destructive one — see each migration's `down` for what its rows
 * were. Deliberately not reachable from the swap path: a failed platform boot reverts the
 * PLATFORM, never the schema (module doc).
 *
 * Refused whole, before anything runs, if any migration in range declares no `down`: a
 * partial rollback would leave the database at a version whose meaning nobody wrote down.
 * Each `down` commits with its version stamp, so an interrupted run stops at a real version.
 */
export function rollbackTo(
  db: DatabaseSync,
  targetVersion: number,
): { from: number; to: number; reverted: readonly string[] } {
  const from = schemaVersion(db);
  if (targetVersion < 0) throw new Error(`target version ${targetVersion} is negative`);
  if (targetVersion > from) {
    throw new Error(`database is at version ${from}, which is already below ${targetVersion}`);
  }
  const toRevert = [...MIGRATIONS]
    .filter((m) => m.version > targetVersion && m.version <= from)
    .sort((a, b) => b.version - a.version);
  const blocked = toRevert.find((m) => m.down === null);
  if (blocked) throw new IrreversibleMigrationError(blocked);

  const reverted: string[] = [];
  for (const m of toRevert) {
    db.exec("BEGIN");
    try {
      m.down!(db);
      // Versions are contiguous, so the predecessor of `m` is exactly m.version - 1.
      db.exec(`PRAGMA user_version = ${m.version - 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`rollback of migration ${m.version} (${m.name}) failed: ${String(err)}`, {
        cause: err,
      });
    }
    reverted.push(m.name);
  }
  return { from, to: schemaVersion(db), reverted };
}
