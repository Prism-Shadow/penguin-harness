/**
 * The organization's relational store, `company.db`: one SQLite file per organization
 * (`<root>/<projectId>/organizations/<orgId>/company.db`), shared by company-proposals and
 * company-roadmaps. Each plugin opens its own connection and writes only its own tables —
 * this plugin `proposal_*`, `graph_*` and `pr_status`.
 *
 * The store guarantees the data itself: primary and foreign keys, column types and value
 * domains, NOT NULL, and an append-only history — a revision, an event is a new row, and the
 * triggers below refuse to rewrite or delete one. Every process rule (revision numbers,
 * terminal states, who may do what, uniqueness of an impl) lives in guards.ts, replaceable.
 *
 * There is no migration runner: the tables are created at open with IF NOT EXISTS. Until the
 * first release a schema change during development means recreating `company.db`.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** The file's name inside the organization directory. */
export const COMPANY_DB = "company.db";

/** Where an organization's store lives (the layout organization/paths.ts composes). */
export function companyDbPath(root: string, projectId: string, orgId: string): string {
  return path.join(root, projectId, "organizations", orgId, COMPANY_DB);
}

const noRewrite = (table: string): string => `
CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
  BEGIN SELECT RAISE(ABORT, 'history_append_only'); END;
CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
  BEGIN SELECT RAISE(ABORT, 'history_append_only'); END;`;

/** The proposal tables. Large text columns come last, so a query of the small ones never reads overflow pages. */
export const PROPOSAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS proposal_seq (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  number             INTEGER PRIMARY KEY,
  status             TEXT NOT NULL CHECK (status IN ('drafting','ready','approved','merged','rejected')),
  revision           INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  approved_revision  INTEGER,
  author             TEXT NOT NULL,
  implementer        TEXT,
  delegated_by       TEXT NOT NULL,
  roadmap_number     INTEGER,
  roadmap_key        TEXT,
  roadmap_create_key TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  seq                INTEGER NOT NULL,
  title              TEXT NOT NULL,
  brief              TEXT NOT NULL,
  CHECK ((roadmap_number IS NULL) = (roadmap_key IS NULL))
);
CREATE INDEX IF NOT EXISTS proposals_by_status ON proposals (status, number DESC);
CREATE UNIQUE INDEX IF NOT EXISTS proposals_from_roadmap
  ON proposals (roadmap_number, roadmap_key, roadmap_create_key) WHERE roadmap_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS proposal_revisions (
  number   INTEGER NOT NULL REFERENCES proposals(number),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  by       TEXT NOT NULL,
  at       TEXT NOT NULL,
  title    TEXT NOT NULL,
  root     TEXT NOT NULL DEFAULT '',
  scope    TEXT NOT NULL,
  tests    TEXT NOT NULL DEFAULT '[]',
  sections TEXT NOT NULL,
  PRIMARY KEY (number, revision)
) WITHOUT ROWID;
${noRewrite("proposal_revisions")}

CREATE TABLE IF NOT EXISTS proposal_events (
  seq      INTEGER PRIMARY KEY,
  number   INTEGER NOT NULL REFERENCES proposals(number),
  at       TEXT NOT NULL,
  kind     TEXT NOT NULL,
  by       TEXT NOT NULL,
  revision INTEGER,
  url      TEXT,
  text     TEXT
);
CREATE INDEX IF NOT EXISTS proposal_events_by_number ON proposal_events (number, seq, by);
${noRewrite("proposal_events")}

CREATE TABLE IF NOT EXISTS proposal_materials (
  id     INTEGER PRIMARY KEY,
  number INTEGER NOT NULL REFERENCES proposals(number),
  kind   TEXT NOT NULL CHECK (kind IN ('pr','issue','branch','doc','ticket','url')),
  label  TEXT NOT NULL,
  url    TEXT NOT NULL,
  pr_key TEXT,
  by     TEXT NOT NULL,
  at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proposal_materials_by_number ON proposal_materials (number, id);

CREATE TABLE IF NOT EXISTS proposal_impls (
  number      INTEGER PRIMARY KEY REFERENCES proposals(number),
  head_remote TEXT, head_branch TEXT,
  head_key    TEXT,
  base_remote TEXT, base_branch TEXT,
  pr_url      TEXT, pr_label TEXT,
  pr_key      TEXT,
  by          TEXT NOT NULL,
  at          TEXT NOT NULL,
  CHECK ((head_remote IS NULL) = (base_remote IS NULL) AND (head_remote IS NULL) = (head_key IS NULL)),
  CHECK (head_key IS NOT NULL OR pr_key IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS proposal_impls_pr   ON proposal_impls (pr_key)   WHERE pr_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS proposal_impls_head ON proposal_impls (head_key) WHERE head_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS proposal_sessions (
  session_id   TEXT PRIMARY KEY,
  number       INTEGER NOT NULL REFERENCES proposals(number),
  kind         TEXT NOT NULL CHECK (kind IN ('implementation','discussion')),
  agent_id     TEXT,
  by           TEXT NOT NULL,
  at           TEXT NOT NULL,
  concluded_by TEXT, concluded_at TEXT, conclusion TEXT,
  CHECK (kind = 'discussion' OR concluded_by IS NULL)
);
CREATE INDEX IF NOT EXISTS proposal_sessions_by_number ON proposal_sessions (number, at);

CREATE TABLE IF NOT EXISTS proposal_batches (
  number   INTEGER NOT NULL REFERENCES proposals(number),
  id       TEXT NOT NULL,
  revision INTEGER NOT NULL,
  by       TEXT NOT NULL,
  at       TEXT NOT NULL,
  open     INTEGER NOT NULL DEFAULT 1 CHECK (open IN (0, 1)),
  PRIMARY KEY (number, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS proposal_batches_open ON proposal_batches (number) WHERE open = 1;

CREATE TABLE IF NOT EXISTS proposal_comments (
  number        INTEGER NOT NULL REFERENCES proposals(number),
  id            TEXT NOT NULL,
  ord           INTEGER NOT NULL,
  by            TEXT NOT NULL,
  at            TEXT NOT NULL,
  batch_id      TEXT,
  section_id    TEXT NOT NULL,
  range_start   INTEGER NOT NULL, range_end INTEGER NOT NULL CHECK (range_end >= range_start),
  revision      INTEGER NOT NULL,
  paragraph_id  TEXT,
  quote         TEXT NOT NULL,
  resolved_by   TEXT, resolved_at TEXT, resolved_text TEXT,
  text          TEXT NOT NULL,
  PRIMARY KEY (number, id),
  FOREIGN KEY (number, batch_id) REFERENCES proposal_batches(number, id)
);
CREATE INDEX IF NOT EXISTS proposal_comments_by_number ON proposal_comments (number, ord);
CREATE INDEX IF NOT EXISTS proposal_comments_pending ON proposal_comments (by, number) WHERE batch_id IS NULL;

CREATE TABLE IF NOT EXISTS proposal_reads (
  user_id TEXT NOT NULL,
  number  INTEGER NOT NULL REFERENCES proposals(number),
  seq     INTEGER NOT NULL,
  PRIMARY KEY (user_id, number)
) WITHOUT ROWID;
`;

/** The PR graph's derived facts, its snapshots and its refresher's state, and the PR status cache. */
export const GRAPH_SCHEMA = `
CREATE TABLE IF NOT EXISTS graph_refs (
  repo TEXT NOT NULL, ref TEXT NOT NULL,
  oid  TEXT NOT NULL, read_at TEXT NOT NULL,
  PRIMARY KEY (repo, ref)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS graph_pulls (
  repo TEXT NOT NULL, number INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open','merged','closed')),
  branch TEXT NOT NULL, head TEXT NOT NULL, base TEXT NOT NULL,
  draft INTEGER NOT NULL DEFAULT 0, url TEXT NOT NULL, closed_at TEXT, title TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (repo, number)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS graph_pulls_by_branch ON graph_pulls (repo, branch, state);
CREATE INDEX IF NOT EXISTS graph_pulls_by_state ON graph_pulls (repo, state);

CREATE TABLE IF NOT EXISTS graph_comparisons (
  repo TEXT NOT NULL, from_sha TEXT NOT NULL, to_sha TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('ahead','behind','same','diverged')),
  ahead INTEGER NOT NULL, behind INTEGER NOT NULL, merge_base TEXT, empty INTEGER NOT NULL,
  used_at TEXT NOT NULL,
  PRIMARY KEY (repo, from_sha, to_sha)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS graph_comparisons_to ON graph_comparisons (repo, to_sha);

CREATE TABLE IF NOT EXISTS graph_snapshots (
  repo TEXT NOT NULL, base TEXT NOT NULL, input_key TEXT NOT NULL,
  built_at TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  graph TEXT NOT NULL,
  PRIMARY KEY (repo, base, input_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS graph_snapshots_latest ON graph_snapshots (repo, base, built_at DESC);

CREATE TABLE IF NOT EXISTS graph_refresh (
  repo TEXT PRIMARY KEY, holder TEXT, lease_until TEXT,
  unchanged INTEGER NOT NULL DEFAULT 0,
  next_probe_at TEXT,
  default_branch TEXT,
  last_ok_at TEXT, last_error TEXT
);

CREATE TABLE IF NOT EXISTS pr_status (
  key TEXT PRIMARY KEY,
  status TEXT CHECK (status IN ('draft','open','merged','closed')),
  base TEXT, default_branch TEXT,
  checked_at TEXT NOT NULL, error TEXT
) WITHOUT ROWID;
`;

// Fetched through process.getBuiltinModule, like the server's web.db: some bundlers' builtin
// lists do not know `node:sqlite` yet.
const sqlite = process.getBuiltinModule("node:sqlite");

/**
 * Opens (creating when absent) an organization's `company.db` for this plugin: WAL, a 5 s busy
 * timeout and foreign keys, as the server's `web.db`; then this plugin's tables.
 */
export function openCompanyDb(file: string, schema: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqlite.DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  return db;
}

/**
 * Runs `fn` as one write transaction (`BEGIN IMMEDIATE`): committed when it returns, rolled back
 * when it throws. `fn` is synchronous — no `await` inside a transaction — so two connections of
 * one process never interleave their transactions.
 */
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
