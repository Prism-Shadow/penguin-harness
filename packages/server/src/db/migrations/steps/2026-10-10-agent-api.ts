import type { Migration } from "../migration.js";

export const agentApi: Migration = {
  name: "2026-10-10-agent-api",
  // Additive: two new tables and an index. The Agent API's per-Agent settings (the switch,
  // keyless access, the approval mode API Sessions are created with) and its keys, stored
  // hashed. A predecessor build never reads them and serves no /api/amsp route, so a
  // rollback survives it: callers get 404 until a build that knows the tables is back.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of the Agent API feature; do not re-derive from schema.ts.
    // IF NOT EXISTS because the declarative track may already have created them (ADOPTION).
    db.exec(`
        CREATE TABLE IF NOT EXISTS agent_api (          -- per-Agent public API settings (amsp/routes.ts); NOT rebuildable from files
          project_id    TEXT NOT NULL,
          agent_id      TEXT NOT NULL,
          enabled       INTEGER NOT NULL DEFAULT 0,
          open          INTEGER NOT NULL DEFAULT 0,
          approval_mode TEXT NOT NULL DEFAULT 'allow-all',
          updated_at    TEXT NOT NULL,
          PRIMARY KEY (project_id, agent_id)
        );
        CREATE TABLE IF NOT EXISTS agent_api_keys (     -- one row per key the API tab or the CLI minted; the caller alone holds the key
          key_id       TEXT PRIMARY KEY,
          project_id   TEXT NOT NULL,
          agent_id     TEXT NOT NULL,
          token_hash   TEXT NOT NULL UNIQUE,
          prefix       TEXT NOT NULL,
          name         TEXT NOT NULL,
          created_by   TEXT NOT NULL REFERENCES users(user_id),
          created_at   TEXT NOT NULL,
          last_used_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_agent_api_keys_agent ON agent_api_keys(project_id, agent_id);
      `);
  },
  // LOSES every Agent's API settings and every key: each exposed Agent reads as disabled
  // again (404 to its callers), and every caller needs a newly created key once it is back
  // on — no file holds a copy of either.
  down(db) {
    db.exec(`
        DROP INDEX IF EXISTS idx_agent_api_keys_agent;
        DROP TABLE IF EXISTS agent_api_keys;
        DROP TABLE IF EXISTS agent_api;
      `);
  },
};
