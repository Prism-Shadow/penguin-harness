import type { Migration } from "../migration.js";

export const modelTablesAdoption: Migration = {
  name: "model-tables-adoption",
  // A data root that ran the chain before it was restacked onto main (2026-09-23) is
  // stamped 16 under THAT line's numbering, where 9 and 10 were sessions-sandbox and
  // machines-columns. This line numbers main's model-promotions and
  // model-provider-auth-tokens 9 and 10 and everything after them two higher, so such a
  // root reads both as already applied, reaches 18 without `model_promotions` or
  // `model_provider_auth_tokens`, and answers 500 wherever cost or provider auth reads
  // them (the models page, an organization's overview). Seen on 53531 at the first push
  // of the restacked line.
  //
  // Re-runs 9's and 10's own `up` — the frozen DDL, both `IF NOT EXISTS`, so a root that
  // took them in their proper place finds its work done. The ledger ended the numbering
  // hazard: adopting a numbered root runs model-promotions and model-provider-auth-tokens
  // themselves. Remove together with the ledger's adoption of numbered roots (index.ts).
  swapSafe: true,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_promotions (
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        provider   TEXT NOT NULL,
        model_id   TEXT NOT NULL,
        discount   REAL NOT NULL CHECK (discount > 0 AND discount < 1),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, provider, model_id)
      );
      CREATE TABLE IF NOT EXISTS model_provider_auth_tokens (
        project_id              TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        provider                TEXT NOT NULL,
        refresh_token           TEXT NOT NULL,
        access_token_expires_at TEXT,
        updated_at              TEXT NOT NULL,
        PRIMARY KEY (project_id, provider)
      );
    `);
  },
  // Nothing to undo: the tables are model-promotions' and model-provider-auth-tokens', and
  // their own downs drop them.
  down() {},
};
