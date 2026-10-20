import type { Migration } from "../migration.js";

export const scheduleWebhooks: Migration = {
  name: "2026-10-20-schedule-webhooks",
  // Webhook triggers for schedules (at most one per task): the bearer token in the
  // public ingress URL is the credential, the optional secret authenticates the sender.
  // Deliveries double as the idempotency record — (trigger_id, dedupe_key) is unique
  // while the key is set; both engines treat NULL keys as distinct, so keyless
  // deliveries never collide.
  swapSafe: true,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schedule_webhook_triggers (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        agent_id    TEXT NOT NULL,
        name        TEXT NOT NULL,
        token       TEXT NOT NULL,
        provider    TEXT NOT NULL DEFAULT 'generic',
        secret      TEXT,
        enabled     INTEGER NOT NULL DEFAULT 1,
        last_fired_at TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE (project_id, agent_id, name),
        UNIQUE (token)
      );
      CREATE TABLE IF NOT EXISTS schedule_webhook_deliveries (
        id               TEXT PRIMARY KEY,
        trigger_id       TEXT NOT NULL,
        dedupe_key       TEXT,
        event            TEXT NOT NULL DEFAULT '',
        signature_status TEXT NOT NULL DEFAULT 'not_required',
        status           TEXT NOT NULL DEFAULT 'queued',
        firing_id        INTEGER,
        payload          TEXT NOT NULL DEFAULT '',
        headers          TEXT NOT NULL DEFAULT '{}',
        attempt_count    INTEGER NOT NULL DEFAULT 1,
        created_at       TEXT NOT NULL,
        UNIQUE (trigger_id, dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_trigger ON schedule_webhook_deliveries(trigger_id, created_at);
    `);
  },
  // Keep triggers and deliveries on rollback: the audit trail survives, and builds that
  // predate the migration ignore tables they do not know. (A dropping down would also
  // break the shape round-trip every per-step test asserts.)
  down() {},
};
