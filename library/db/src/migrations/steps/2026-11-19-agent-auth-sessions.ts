import type { Migration } from "../migration.js";

export const agentAuthSessions: Migration = {
  name: "2026-11-19-agent-auth-sessions",
  // Additive: two new tables. The Agent auth-session mechanism issues the Agent the same
  // shape of server-side session row the user auth keeps, plus one counters row per Agent
  // for the permission generation every session stamps. A predecessor build never reads
  // either and keeps authenticating Agents through their API keys, so a rollback survives.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of the mechanism's introduction; do not re-derive from
    // schema.ts. IF NOT EXISTS because the declarative track may already have created it.
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_auth_sessions ( -- server-side sessions for Agents: the token the Agent presents is a Bearer, the row its sha256; issued at Agent creation, dropped with the Agent
        token_hash  TEXT PRIMARY KEY,                -- sha256(token) hex; the Agent stores only the raw token
        project_id  TEXT NOT NULL,                   -- the Agent's Project
        agent_id    TEXT NOT NULL,                   -- the Agent the session belongs to; all rows of a pair go on its deletion
        role        TEXT NOT NULL,                   -- the role template the session was issued with; the permission set re-derives from the Agent's CURRENT generation, never from here
        generation  INTEGER NOT NULL,               -- the permission generation at issue time; a stale one re-derives (see agent_auth_generations)
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        last_used_at TEXT                           -- stamped once per authenticated request; NULL = never used
      );
      CREATE INDEX IF NOT EXISTS idx_agent_auth_sessions_agent ON agent_auth_sessions(project_id, agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_auth_sessions_expires ON agent_auth_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS agent_auth_generations ( -- one row per Agent: the CURRENT permission generation; bumping it re-derives every live session's permission set on its next request
        project_id  TEXT NOT NULL,
        agent_id    TEXT NOT NULL,
        generation  INTEGER NOT NULL,
        role        TEXT NOT NULL,                  -- the Agent's current role template; re-derivation reads THIS, not the session's stamped role
        allowed_apis TEXT NOT NULL DEFAULT '[]',    -- the granted HTTP route ids, JSON array
        PRIMARY KEY (project_id, agent_id)
      );
    `);
  },
  // LOSES every Agent session and generation row: issued sessions stop authenticating and
  // re-derivation has nothing to read until the next issue/bump, which re-creates both.
  down(db) {
    db.exec("DROP TABLE IF EXISTS agent_auth_generations");
    db.exec("DROP TABLE IF EXISTS agent_auth_sessions");
  },
};
