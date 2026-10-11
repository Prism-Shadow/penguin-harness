import type { Migration } from "../migration.js";

export const modelProviderAuthTokens: Migration = {
  name: "model-provider-auth-tokens",
  // Additive: one new table, nothing existing touched. A predecessor build never reads it;
  // the access token already written into .project_config.toml keeps working until it
  // expires, so rollback only loses silent refresh state.
  // KEEP until every supported upgrade starts from a database that already has this table.
  // The release that raises the minimum database baseline past it owns removing this
  // migration and its fixture; the table itself remains while provider token refresh uses it.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of the provider-auth-token feature; do not re-derive from
    // schema.ts. IF NOT EXISTS because the declarative track may already have created it
    // (RE-RUNNABLE in index.ts).
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_provider_auth_tokens ( -- Server-side OAuth refresh metadata for provider groups. The current request token remains in .project_config.toml as api_key; this table holds only the refresh material that must never be returned to the frontend or written into Project files.
        project_id              TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        provider                TEXT NOT NULL,
        refresh_token           TEXT NOT NULL,
        access_token_expires_at TEXT,
        updated_at              TEXT NOT NULL,
        PRIMARY KEY (project_id, provider)
      );
    `);
  },
  // LOSES every stored refresh token and access-token expiry. Existing access tokens in
  // Project files remain until they expire; users re-authorize to restore silent refresh.
  down(db) {
    db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  },
};
