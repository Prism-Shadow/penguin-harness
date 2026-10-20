/**
 * Schedule webhook triggers (pure orchestration; the routes are thin): bearer-token
 * ingress in Multica's shape — a public URL per schedule, HMAC-SHA256 sender proof,
 * header-carried idempotency keys, and safe replays — slimmed to this server's
 * substrate (file schedules fired through fireNow, no async worker, no redis).
 *
 * Provider conventions (Multica's pair): `generic` reads `Idempotency-Key` for dedupe
 * and `X-Webhook-Signature` for the HMAC; `github` reads `X-GitHub-Delivery` and
 * `X-Hub-Signature-256`. A configured secret is always enforced (fail closed); without
 * one the bearer token is the whole credential (`not_required`).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  ScheduleWebhooksRepo,
  WebhookDeliveryRow,
  WebhookProvider,
  WebhookSignatureStatus,
  WebhookTriggerRow,
} from "../db/repos/schedule-webhooks.js";
import { ScheduleFireError } from "./scheduler.js";

/** Payloads past this are refused before parsing (the route enforces it too). */
export const WEBHOOK_BODY_LIMIT = 256 * 1024;
/** Public ingress mount; the token is the last segment. */
export const WEBHOOK_PATH_PREFIX = "/api/webhooks/schedules";

export const webhookPath = (token: string): string => `${WEBHOOK_PATH_PREFIX}/${token}`;
export const mintWebhookToken = (): string => `whk_${randomBytes(24).toString("hex")}`;
export const mintWebhookId = (prefix: "wht" | "whd"): string =>
  `${prefix}_${randomBytes(12).toString("hex")}`;
export const secretHint = (secret: string): string => secret.slice(-4);

export function isWebhookProvider(value: unknown): value is WebhookProvider {
  return value === "generic" || value === "github";
}

/** The only request headers the flow reads (lowercase) — and the only ones it stores. */
const KEPT_HEADERS = [
  "idempotency-key",
  "x-github-delivery",
  "x-github-event",
  "x-hub-signature-256",
  "x-webhook-signature",
];

export function selectedHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const value = headers[name];
    if (value !== undefined && value !== "") out[name] = value.slice(0, 500);
  }
  return out;
}

/** The provider's idempotency identifier, or null when the sender sent none. */
export function dedupeKeyFor(
  provider: WebhookProvider,
  headers: Record<string, string | undefined>,
): string | null {
  const raw = provider === "github" ? headers["x-github-delivery"] : headers["idempotency-key"];
  const key = (raw ?? "").trim();
  return key === "" ? null : key.slice(0, 200);
}

function signatureHeader(provider: WebhookProvider): string {
  return provider === "github" ? "x-hub-signature-256" : "x-webhook-signature";
}

function hmacOk(secret: string, header: string, rawBody: string): boolean {
  const m = /^sha256=([0-9a-fA-F]+)$/.exec(header.trim());
  if (!m) return false;
  const want = Buffer.from(m[1]!, "hex");
  const got = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The HMAC verdict: `not_required` when the trigger carries no secret. */
export function verifySignature(args: {
  provider: WebhookProvider;
  secret: string | null;
  headers: Record<string, string | undefined>;
  rawBody: string;
}): WebhookSignatureStatus {
  if (args.secret === null || args.secret === "") return "not_required";
  const header = args.headers[signatureHeader(args.provider)];
  if (header === undefined || header.trim() === "") return "missing";
  return hmacOk(args.secret, header, args.rawBody) ? "verified" : "invalid";
}

/** The event scope, for the audit row: the GitHub event header, or a generic `event` field. */
export function inferEvent(
  provider: WebhookProvider,
  headers: Record<string, string | undefined>,
  body: unknown,
): string {
  if (provider === "github") return (headers["x-github-event"] ?? "").trim().slice(0, 100);
  const event = (body as { event?: unknown } | null)?.event;
  return typeof event === "string" ? event.trim().slice(0, 100) : "";
}

export type WebhookGate =
  { kind: "active" } | { kind: "gone" } | { kind: "ignored"; reason: string };

export type WebhookOutcome =
  | { status: "accepted"; deliveryId: string; runId: string; queued: boolean }
  | { status: "duplicate"; deliveryId: string; runId: string | null; attemptCount: number }
  | { status: "ignored"; deliveryId: string; reason: string }
  | { status: "rejected"; deliveryId: string; reason: string }
  | { status: "gone" }
  | { status: "bad_json" };

export interface WebhookFire {
  (
    projectId: string,
    agentId: string,
    name: string,
  ): Promise<{ sessionId: string; queued: boolean }>;
}

/**
 * One delivery, end to end: persist-first like Multica (the row exists before the fire),
 * a duplicate answers from the original row without firing, a rejected or ignored
 * delivery still leaves its audit row. Throws only when the fire itself fails — the
 * route turns that into a 500, and the delivery keeps its `queued` status for the retry.
 */
export async function handleWebhookDelivery(args: {
  repo: ScheduleWebhooksRepo;
  trigger: WebhookTriggerRow;
  rawBody: string;
  headers: Record<string, string | undefined>;
  gate: WebhookGate;
  fire: WebhookFire;
  nowIso: string;
}): Promise<WebhookOutcome> {
  const { repo, trigger } = args;
  if (args.gate.kind === "gone") return { status: "gone" };
  let body: unknown;
  try {
    body = JSON.parse(args.rawBody) as unknown;
  } catch {
    // No persistence: there is no dedupe identifier to trust from an unparsable body.
    return { status: "bad_json" };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { status: "bad_json" };
  }
  const signature = verifySignature({
    provider: trigger.provider,
    secret: trigger.secret,
    headers: args.headers,
    rawBody: args.rawBody,
  });
  const deliveryId = mintWebhookId("whd");
  const inserted = repo.insertDelivery({
    id: deliveryId,
    triggerId: trigger.id,
    dedupeKey: dedupeKeyFor(trigger.provider, args.headers),
    event: inferEvent(trigger.provider, args.headers, body),
    signatureStatus: signature,
    payload: args.rawBody.slice(0, 64 * 1024),
    headers: JSON.stringify(selectedHeaders(args.headers)),
    nowIso: args.nowIso,
  });
  if (!inserted) {
    const key = dedupeKeyFor(trigger.provider, args.headers);
    const original = key === null ? null : repo.getDeliveryByDedupe(trigger.id, key);
    if (original === null) {
      // Lost a race with a deleter between the insert and the read; the retry lands clean.
      return { status: "duplicate", deliveryId, runId: null, attemptCount: 1 };
    }
    repo.bumpAttempt(original.id);
    const runId = original.firingId === null ? null : repo.firingSession(original.firingId);
    return {
      status: "duplicate",
      deliveryId: original.id,
      runId,
      attemptCount: original.attemptCount + 1,
    };
  }
  if (signature === "invalid" || signature === "missing") {
    repo.setDeliveryOutcome(deliveryId, { status: "rejected", signatureStatus: signature });
    return {
      status: "rejected",
      deliveryId,
      reason:
        signature === "missing" ? "signature is required but missing." : "signature mismatch.",
    };
  }
  if (!trigger.enabled) {
    repo.setDeliveryOutcome(deliveryId, { status: "ignored" });
    return { status: "ignored", deliveryId, reason: "trigger is disabled." };
  }
  if (args.gate.kind === "ignored") {
    repo.setDeliveryOutcome(deliveryId, { status: "ignored" });
    return { status: "ignored", deliveryId, reason: args.gate.reason };
  }
  let fired: { sessionId: string; queued: boolean };
  try {
    fired = await args.fire(trigger.projectId, trigger.agentId, trigger.name);
  } catch (err) {
    // The task changed shape between the gate and the fire (deleted, invalidated):
    // say so without firing. A session-creation failure rethrows — the delivery
    // stays queued and the route 500s, so the provider's retry still has a chance.
    if (err instanceof ScheduleFireError && err.code !== "schedule_fire_failed") {
      repo.setDeliveryOutcome(deliveryId, { status: "ignored" });
      return { status: "ignored", deliveryId, reason: err.message };
    }
    throw err;
  }
  const firingId = repo.latestFiringId(
    trigger.projectId,
    trigger.agentId,
    trigger.name,
    fired.sessionId,
  );
  repo.setDeliveryOutcome(deliveryId, {
    status: "accepted",
    ...(firingId === null ? {} : { firingId }),
  });
  repo.touchFired(trigger.id, args.nowIso);
  return { status: "accepted", deliveryId, runId: fired.sessionId, queued: fired.queued };
}

/**
 * Replays a delivery on purpose: a NEW delivery row (keyless, so it never dedupes
 * against the original) carrying the same payload, fired fresh. The source row keeps
 * its own firing link; the replay's headers say where it came from.
 */
export async function replayWebhookDelivery(args: {
  repo: ScheduleWebhooksRepo;
  trigger: WebhookTriggerRow;
  delivery: WebhookDeliveryRow;
  fire: WebhookFire;
  nowIso: string;
}): Promise<{ deliveryId: string; runId: string; queued: boolean }> {
  const { repo, trigger, delivery } = args;
  const fired = await args.fire(trigger.projectId, trigger.agentId, trigger.name);
  const firingId = repo.latestFiringId(
    trigger.projectId,
    trigger.agentId,
    trigger.name,
    fired.sessionId,
  );
  const deliveryId = mintWebhookId("whd");
  repo.insertDelivery({
    id: deliveryId,
    triggerId: trigger.id,
    dedupeKey: null,
    event: delivery.event,
    signatureStatus: "not_required",
    payload: delivery.payload,
    headers: JSON.stringify({ replayed_from: delivery.id }),
    nowIso: args.nowIso,
  });
  repo.setDeliveryOutcome(deliveryId, {
    status: "accepted",
    ...(firingId === null ? {} : { firingId }),
  });
  repo.touchFired(trigger.id, args.nowIso);
  return { deliveryId, runId: fired.sessionId, queued: fired.queued };
}

/**
 * The ingress rate gate: a sliding window per IP, in memory (it resets on restart —
 * the bearer token stays the real credential; this only blunts floods). Multica keeps
 * this state in redis; this server has none, and the day it needs one this class is
 * the seam to replace.
 */
export class WebhookRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number = 60,
    private readonly windowMs: number = 60_000,
  ) {}

  allow(ip: string, nowMs: number): boolean {
    if (this.hits.size > 5000) {
      const cutoff = nowMs - this.windowMs;
      for (const [key, at] of this.hits) {
        if (at.every((t) => t <= cutoff)) this.hits.delete(key);
      }
    }
    const at = this.hits.get(ip) ?? [];
    const fresh = at.filter((t) => t > nowMs - this.windowMs);
    if (fresh.length >= this.limit) {
      this.hits.set(ip, fresh);
      return false;
    }
    fresh.push(nowMs);
    this.hits.set(ip, fresh);
    return true;
  }
}
