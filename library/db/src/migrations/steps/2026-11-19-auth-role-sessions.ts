import type { Migration } from "../migration.js";

export const authRoleSessions: Migration = {
  name: "2026-11-19-auth-role-sessions",
  // Additive: two new tables for role-bound authorization sessions and permission generations,
  // serving both Agents and human principals. A predecessor build never reads either and keeps
  // authenticating through existing tables, so a rollback survives.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of the mechanism's introduction; do not re-derive from
    // schema.ts. IF NOT EXISTS because the declarative track may already have created it.
    db.exec(`
      CREATE TABLE IF NOT EXISTS auth_role_sessions (
        token_hash   TEXT NOT NULL PRIMARY KEY,      -- sha256(token) hex; caller stores only the raw token
        subject_id   TEXT NOT NULL,                  -- principal key ('agent:<projectId>/<agentId>' or 'user:<userId>')
        subject_kind TEXT NOT NULL DEFAULT 'agent',  -- 'agent' | 'user'
        user_id      TEXT,                           -- human user_id when issued to a person; NULL for Agent sessions
        project_id   TEXT,                           -- Project scope when bound to a Project or Agent; NULL for global user sessions
        agent_id     TEXT,                           -- Agent id when issued to an Agent; NULL for human sessions
        role         TEXT NOT NULL,                  -- the role template at issue time; re-derivation reads auth_generations.role
        generation   INTEGER NOT NULL,               -- the permission generation at issue time; a stale one re-derives
        created_at   TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        last_used_at TEXT                            -- stamped once per authenticated request; NULL = never used
      );
      CREATE INDEX IF NOT EXISTS idx_auth_role_sessions_subject ON auth_role_sessions(subject_id);
      CREATE INDEX IF NOT EXISTS idx_auth_role_sessions_agent ON auth_role_sessions(project_id, agent_id);
      CREATE INDEX IF NOT EXISTS idx_auth_role_sessions_user ON auth_role_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_role_sessions_expires ON auth_role_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS auth_generations (
        subject_id   TEXT NOT NULL PRIMARY KEY,      -- principal key matching auth_role_sessions.subject_id
        subject_kind TEXT NOT NULL DEFAULT 'agent',  -- 'agent' | 'user'
        user_id      TEXT,                           -- human user_id when principal is a person; NULL for Agents
        project_id   TEXT,                           -- Project scope when bound to a Project or Agent
        agent_id     TEXT,                           -- Agent id when principal is an Agent; NULL for human principals
        generation   INTEGER NOT NULL,
        role         TEXT NOT NULL,                  -- current role template; re-derivation reads THIS, not the session's stamped role
        allowed_apis TEXT NOT NULL DEFAULT '[]'      -- persisted grant expressions (route ids, role ids, and <roleOrRoute>@<refinerId> specs), JSON array
      );
      CREATE INDEX IF NOT EXISTS idx_auth_generations_agent ON auth_generations(project_id, agent_id);
      CREATE INDEX IF NOT EXISTS idx_auth_generations_user ON auth_generations(user_id);
    `);
  },
  // LOSES every role-bound session and generation row: issued sessions stop authenticating and
  // re-derivation has nothing to read until the next issue/bump, which re-creates both.
  down(db) {
    db.exec("DROP TABLE IF EXISTS auth_generations");
    db.exec("DROP TABLE IF EXISTS auth_role_sessions");
  },
};
