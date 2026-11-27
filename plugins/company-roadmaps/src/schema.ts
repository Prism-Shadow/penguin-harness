/**
 * The roadmap tables of the organization's relational store, `company.db`
 * (`<root>/<projectId>/organizations/<orgId>/company.db`). The file is shared with
 * company-proposals: each plugin opens its own connection and writes only its own tables — this
 * plugin the `roadmap*` ones. It does not read the proposals' tables; it reaches proposals only
 * through ProposalCreator.
 *
 * The store guarantees the data itself — keys, types, value domains, NOT NULL — and an
 * append-only history: a draft, an approval, an event is a new row, and the triggers refuse to
 * rewrite or delete one. The process rules are in guards.ts. Tables are created at open with IF
 * NOT EXISTS; there is no migration runner: a column added later is added at open as well, when
 * the table lacks it ({@link addRoadmapModerator}).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { orgDirOf } from "./domain.js";

/** The file's name inside the organization directory (the same file company-proposals opens). */
export const COMPANY_DB = "company.db";

export function companyDbPath(root: string, projectId: string, orgId: string): string {
  return path.join(orgDirOf(root, projectId, orgId), COMPANY_DB);
}

const noRewrite = (table: string): string => `
CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
  BEGIN SELECT RAISE(ABORT, 'history_append_only'); END;
CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
  BEGIN SELECT RAISE(ABORT, 'history_append_only'); END;`;

export const ROADMAP_SCHEMA = `
CREATE TABLE IF NOT EXISTS roadmap_seq (id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS roadmaps (
  number      INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('awaiting_room','discussing','established')),
  channel_id  TEXT,
  parent      INTEGER REFERENCES roadmaps(number),
  parent_item TEXT,
  employees   TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  brief       TEXT NOT NULL,
  record      TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  moderator   TEXT
);
CREATE INDEX IF NOT EXISTS roadmaps_by_channel ON roadmaps (channel_id, status, number) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS roadmaps_by_status ON roadmaps (status, number);

CREATE TABLE IF NOT EXISTS roadmap_drafts (
  number  INTEGER NOT NULL REFERENCES roadmaps(number),
  seq     INTEGER NOT NULL,
  by      TEXT NOT NULL,
  at      TEXT NOT NULL,
  record  TEXT, body TEXT, items TEXT,
  PRIMARY KEY (number, seq)
) WITHOUT ROWID;
${noRewrite("roadmap_drafts")}

CREATE TABLE IF NOT EXISTS roadmap_items (
  number     INTEGER NOT NULL REFERENCES roadmaps(number),
  key        TEXT NOT NULL,
  position   INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('proposal','roadmap')),
  title      TEXT NOT NULL,
  owner      TEXT,
  employees  TEXT,
  cites      TEXT NOT NULL DEFAULT '[]',
  stack      TEXT NOT NULL DEFAULT 'previous' CHECK (stack IN ('previous','none','item')),
  stacked_on TEXT,
  proposal   INTEGER,
  brief      TEXT NOT NULL,
  PRIMARY KEY (number, key),
  UNIQUE (number, position),
  CHECK ((stack = 'item') = (stacked_on IS NOT NULL)),
  CHECK ((kind = 'proposal') = (owner IS NOT NULL))
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS roadmap_delegations (
  number    INTEGER NOT NULL REFERENCES roadmaps(number),
  key       TEXT NOT NULL,
  owner     TEXT NOT NULL,
  stage     TEXT NOT NULL CHECK (stage IN ('brief','delegated')),
  base      TEXT,
  child     INTEGER REFERENCES roadmaps(number),
  proposal  INTEGER,
  delivered INTEGER NOT NULL DEFAULT 0 CHECK (delivered IN (0, 1)),
  error     TEXT,
  brief_sha TEXT NOT NULL,
  brief     TEXT NOT NULL,
  PRIMARY KEY (number, key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS roadmap_delegations_by_proposal ON roadmap_delegations (proposal) WHERE proposal IS NOT NULL;

CREATE TABLE IF NOT EXISTS roadmap_approvals (
  number    INTEGER NOT NULL,
  key       TEXT NOT NULL,
  brief_sha TEXT NOT NULL,
  role      TEXT NOT NULL,
  by        TEXT NOT NULL,
  at        TEXT NOT NULL,
  PRIMARY KEY (number, key, brief_sha, role),
  FOREIGN KEY (number, key) REFERENCES roadmap_delegations(number, key)
) WITHOUT ROWID;
${noRewrite("roadmap_approvals")}

CREATE TABLE IF NOT EXISTS roadmap_events (
  seq    INTEGER PRIMARY KEY,
  number INTEGER NOT NULL REFERENCES roadmaps(number),
  at     TEXT NOT NULL,
  by     TEXT NOT NULL,
  kind   TEXT NOT NULL,
  note   TEXT
);
CREATE INDEX IF NOT EXISTS roadmap_events_by_number ON roadmap_events (number, seq);
${noRewrite("roadmap_events")}
`;

// Fetched through process.getBuiltinModule, like the server's web.db: some bundlers' builtin
// lists do not know `node:sqlite` yet.
const sqlite = process.getBuiltinModule("node:sqlite");

/**
 * Opens (creating when absent) an organization's `company.db` and this plugin's tables: WAL, a
 * 5 s busy timeout and foreign keys, as the server's `web.db`. company-proposals opens the same
 * file with the same settings; the two plugins share no code, so the few lines are repeated.
 */
export function openCompanyDb(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqlite.DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(ROADMAP_SCHEMA);
  addRoadmapModerator(db);
  return db;
}

/**
 * `roadmaps.moderator` (the moderator a `members` write named) on a table created before the
 * column existed: added once, nullable, so every row already there reads null — its moderator
 * stays derived, as it was. Checked again inside the write transaction, since another process
 * may open the same file at the same time. An older build reads the table as before (it selects
 * by name and ignores the column), so nothing needs undoing on a rollback.
 *
 * TODO(roadmap-moderator-column): remove once no `company.db` written before 2026-10-04 can be
 * opened any more — at the latest when the first release that includes roadmap Actions ships,
 * since no released build wrote the `roadmaps` table.
 */
export function addRoadmapModerator(db: DatabaseSync): void {
  const has = (): boolean =>
    (db.prepare(`PRAGMA table_info(roadmaps)`).all() as Array<{ name: string }>).some(
      (c) => c.name === "moderator",
    );
  if (has()) return;
  immediate(db, () => {
    if (!has()) db.exec(`ALTER TABLE roadmaps ADD COLUMN moderator TEXT`);
  });
}

/** One write transaction (`BEGIN IMMEDIATE`), synchronous inside: committed on return, rolled back on a throw. */
export function immediate<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
