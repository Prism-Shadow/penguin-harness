/**
 * Schedule webhook triggers + deliveries: at most one trigger per schedule, whose bearer
 * token is the public ingress URL's credential; one delivery row per accepted POST, which
 * is also the idempotency record — (trigger_id, dedupe_key) is unique while the key is
 * set, and both engines treat NULL keys as distinct so keyless deliveries never collide.
 */
import type { DatabaseSync } from "node:sqlite";

export type WebhookProvider = "generic" | "github";
export type WebhookSignatureStatus = "verified" | "invalid" | "missing" | "not_required";
export type WebhookDeliveryStatus =
  "queued" | "accepted" | "skipped" | "ignored" | "duplicate" | "rejected";

export interface WebhookTriggerRow {
  id: string;
  projectId: string;
  agentId: string;
  name: string;
  token: string;
  provider: WebhookProvider;
  secret: string | null;
  enabled: boolean;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryRow {
  id: string;
  triggerId: string;
  dedupeKey: string | null;
  event: string;
  signatureStatus: WebhookSignatureStatus;
  status: WebhookDeliveryStatus;
  firingId: number | null;
  payload: string;
  headers: string;
  attemptCount: number;
  createdAt: string;
}

function triggerOf(r: Record<string, unknown>): WebhookTriggerRow {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    agentId: r.agent_id as string,
    name: r.name as string,
    token: r.token as string,
    provider: r.provider as WebhookProvider,
    secret: (r.secret as string | null) ?? null,
    enabled: Number(r.enabled) === 1,
    lastFiredAt: (r.last_fired_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function deliveryOf(r: Record<string, unknown>): WebhookDeliveryRow {
  return {
    id: r.id as string,
    triggerId: r.trigger_id as string,
    dedupeKey: (r.dedupe_key as string | null) ?? null,
    event: (r.event as string) ?? "",
    signatureStatus: (r.signature_status as WebhookSignatureStatus) ?? "not_required",
    status: (r.status as WebhookDeliveryStatus) ?? "queued",
    firingId: (r.firing_id as number | null) ?? null,
    payload: (r.payload as string) ?? "",
    headers: (r.headers as string) ?? "{}",
    attemptCount: Number(r.attempt_count ?? 1),
    createdAt: r.created_at as string,
  };
}

export class ScheduleWebhooksRepo {
  constructor(private readonly db: DatabaseSync) {}

  createTrigger(row: {
    id: string;
    projectId: string;
    agentId: string;
    name: string;
    token: string;
    provider: WebhookProvider;
    secret: string | null;
    nowIso: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO schedule_webhook_triggers
           (id, project_id, agent_id, name, token, provider, secret, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        row.id,
        row.projectId,
        row.agentId,
        row.name,
        row.token,
        row.provider,
        row.secret,
        row.nowIso,
        row.nowIso,
      );
  }

  getTrigger(projectId: string, agentId: string, name: string): WebhookTriggerRow | null {
    const row = this.db
      .prepare(
        "SELECT * FROM schedule_webhook_triggers WHERE project_id = ? AND agent_id = ? AND name = ?",
      )
      .get(projectId, agentId, name) as Record<string, unknown> | undefined;
    return row === undefined ? null : triggerOf(row);
  }

  getTriggerByToken(token: string): WebhookTriggerRow | null {
    const row = this.db
      .prepare("SELECT * FROM schedule_webhook_triggers WHERE token = ?")
      .get(token) as Record<string, unknown> | undefined;
    return row === undefined ? null : triggerOf(row);
  }

  updateTrigger(
    id: string,
    patch: { provider?: WebhookProvider; secret?: string | null; enabled?: boolean },
    nowIso: string,
  ): void {
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (patch.provider !== undefined) {
      sets.push("provider = ?");
      params.push(patch.provider);
    }
    if (patch.secret !== undefined) {
      sets.push("secret = ?");
      params.push(patch.secret);
    }
    if (patch.enabled !== undefined) {
      sets.push("enabled = ?");
      params.push(patch.enabled ? 1 : 0);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = ?");
    params.push(nowIso, id);
    this.db
      .prepare(`UPDATE schedule_webhook_triggers SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);
  }

  rotateToken(id: string, token: string, nowIso: string): void {
    this.db
      .prepare("UPDATE schedule_webhook_triggers SET token = ?, updated_at = ? WHERE id = ?")
      .run(token, nowIso, id);
  }

  deleteTrigger(id: string): void {
    // Deliveries stay: they are the audit trail of URLs that no longer resolve.
    this.db.prepare("DELETE FROM schedule_webhook_triggers WHERE id = ?").run(id);
  }

  touchFired(id: string, nowIso: string): void {
    this.db
      .prepare(
        "UPDATE schedule_webhook_triggers SET last_fired_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(nowIso, nowIso, id);
  }

  /**
   * Inserts a delivery; false when its dedupe key already landed on this trigger
   * (the caller then answers from the existing row instead of firing again).
   */
  insertDelivery(row: {
    id: string;
    triggerId: string;
    dedupeKey: string | null;
    event: string;
    signatureStatus: WebhookSignatureStatus;
    payload: string;
    headers: string;
    nowIso: string;
  }): boolean {
    const { changes } = this.db
      .prepare(
        `INSERT INTO schedule_webhook_deliveries
           (id, trigger_id, dedupe_key, event, signature_status, status, payload, headers, created_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)
         ON CONFLICT(trigger_id, dedupe_key) DO NOTHING`,
      )
      .run(
        row.id,
        row.triggerId,
        row.dedupeKey,
        row.event,
        row.signatureStatus,
        row.payload,
        row.headers,
        row.nowIso,
      );
    return changes === 1;
  }

  getDelivery(id: string): WebhookDeliveryRow | null {
    const row = this.db
      .prepare("SELECT * FROM schedule_webhook_deliveries WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row === undefined ? null : deliveryOf(row);
  }

  getDeliveryByDedupe(triggerId: string, dedupeKey: string): WebhookDeliveryRow | null {
    const row = this.db
      .prepare("SELECT * FROM schedule_webhook_deliveries WHERE trigger_id = ? AND dedupe_key = ?")
      .get(triggerId, dedupeKey) as Record<string, unknown> | undefined;
    return row === undefined ? null : deliveryOf(row);
  }

  bumpAttempt(id: string): void {
    this.db
      .prepare(
        "UPDATE schedule_webhook_deliveries SET attempt_count = attempt_count + 1 WHERE id = ?",
      )
      .run(id);
  }

  setDeliveryOutcome(
    id: string,
    outcome: {
      status: WebhookDeliveryStatus;
      signatureStatus?: WebhookSignatureStatus;
      firingId?: number;
    },
  ): void {
    const sets = ["status = ?"];
    const params: Array<string | number | null> = [outcome.status];
    if (outcome.signatureStatus !== undefined) {
      sets.push("signature_status = ?");
      params.push(outcome.signatureStatus);
    }
    if (outcome.firingId !== undefined) {
      sets.push("firing_id = ?");
      params.push(outcome.firingId);
    }
    params.push(id);
    this.db
      .prepare(`UPDATE schedule_webhook_deliveries SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);
  }

  listDeliveries(triggerId: string, limit: number): WebhookDeliveryRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM schedule_webhook_deliveries WHERE trigger_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(triggerId, Math.max(1, Math.min(200, Math.floor(limit)))) as Array<
      Record<string, unknown>
    >;
    return rows.map(deliveryOf);
  }

  /** The newest firing row for a task+session: links a delivery to the fire it just caused. */
  latestFiringId(
    projectId: string,
    agentId: string,
    name: string,
    sessionId: string,
  ): number | null {
    const row = this.db
      .prepare(
        `SELECT id FROM schedule_firings
         WHERE project_id = ? AND agent_id = ? AND name = ? AND session_id = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(projectId, agentId, name, sessionId) as Record<string, unknown> | undefined;
    return row === undefined ? null : Number(row.id);
  }

  /** The session a firing went to: answers a duplicate with its original run. */
  firingSession(firingId: number): string | null {
    const row = this.db
      .prepare("SELECT session_id FROM schedule_firings WHERE id = ?")
      .get(firingId) as Record<string, unknown> | undefined;
    return row === undefined ? null : (row.session_id as string);
  }
}
