/**
 * Schedule webhook ingress (public: the bearer token in the URL is the credential):
 *   POST /api/webhooks/schedules/:token
 *
 * Multica's shape, slimmed: token lookup (404), body cap (413), JSON envelope
 * (400, unpersisted), per-provider idempotency key, HMAC-SHA256 sender proof when the
 * trigger carries a secret (401 + rejected row), disabled/paused schedules ignored
 * (200, no fire), and a duplicate key answers from the original delivery without
 * firing again. Accepted deliveries fire synchronously through fireNow — the same
 * dispatch a hand trigger runs — so the provider's 200 means the run started.
 * The global jsonOnlyWrites gate applies here too: senders must post JSON content
 * (GitHub does), which keeps this public URL unforgeable from an HTML form.
 */
import { Hono } from "hono";
import type { DatabaseSync } from "node:sqlite";
import type { AppEnv } from "../../auth/middleware.js";
import type { Config, Db } from "../../hmr/capabilities.js";
import type { Scheduling } from "../../mechanisms/sessions.js";
import type { ScheduleWebhookIngressResponse } from "../../api/types.js";
import { ScheduleWebhooksRepo } from "../../db/repos/schedule-webhooks.js";
import { HttpError } from "../errors.js";
import { scheduleStatus } from "../../runtime/scheduler.js";
import {
  WEBHOOK_BODY_LIMIT,
  WebhookRateLimiter,
  handleWebhookDelivery,
  type WebhookGate,
} from "../../runtime/schedule-webhooks.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";

/** What this route group reaches — bound by its module (src/modules). */
export interface WebhookRouteDeps {
  config: Config;
  scheduler: Scheduling;
  webhooks: ScheduleWebhooksRepo;
  limiter: WebhookRateLimiter;
}

function clientIp(
  c: { req: { header(name: string): string | undefined } },
  trustProxy: boolean,
): string {
  if (!trustProxy) return "direct";
  const forwarded = c.req.header("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]!.trim();
  return first === "" ? "direct" : first.slice(0, 100);
}

function gateFor(status: string): WebhookGate {
  // Only a live schedule fires; settled, invalid or disabled tasks answer without firing.
  if (status === "active") return { kind: "active" };
  if (status === "disabled") return { kind: "ignored", reason: "schedule is disabled." };
  if (status === "invalid") return { kind: "ignored", reason: "schedule file is invalid." };
  return { kind: "ignored", reason: `schedule is ${status}.` };
}

export function webhookRoutes(deps: WebhookRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/schedules/:token", async (c) => {
    if (!deps.limiter.allow(clientIp(c, deps.config.trustProxy), Date.now())) {
      throw new HttpError(429, "webhook_rate_limited", "Too many webhook deliveries; slow down.");
    }
    const token = c.req.param("token");
    const trigger = deps.webhooks.getTriggerByToken(token);
    if (trigger === null) {
      // Generic on purpose: no oracle for which tokens exist (providers do not retry 404s,
      // so a dropped unknown token stays dropped).
      throw new HttpError(404, "webhook_not_found", "Webhook not found.");
    }
    const rawBody = await c.req.text();
    if (rawBody.length > WEBHOOK_BODY_LIMIT) {
      throw new HttpError(413, "webhook_too_large", "Payload exceeds 256 KiB.");
    }
    const headers: Record<string, string | undefined> = {
      "idempotency-key": c.req.header("idempotency-key") ?? undefined,
      "x-github-delivery": c.req.header("x-github-delivery") ?? undefined,
      "x-github-event": c.req.header("x-github-event") ?? undefined,
      "x-hub-signature-256": c.req.header("x-hub-signature-256") ?? undefined,
      "x-webhook-signature": c.req.header("x-webhook-signature") ?? undefined,
    };
    // The schedule behind the trigger, read fresh: a deleted task reads gone (404,
    // unpersisted like Multica), anything not live reads ignored (200, persisted).
    const { entries } = await deps.scheduler.listAgent(trigger.projectId, trigger.agentId);
    const entry = entries.find((e) => e.def.name === trigger.name);
    const gate: WebhookGate =
      entry === undefined
        ? { kind: "gone" }
        : gateFor(scheduleStatus(entry.def, entry.state, Date.now()));
    const outcome = await handleWebhookDelivery({
      repo: deps.webhooks,
      trigger,
      rawBody,
      headers,
      gate,
      fire: (projectId, agentId, name) => deps.scheduler.fireNow(projectId, agentId, name),
      nowIso: new Date().toISOString(),
    });
    if (outcome.status === "gone") {
      throw new HttpError(404, "webhook_not_found", "Webhook not found.");
    }
    if (outcome.status === "bad_json") {
      throw new HttpError(400, "webhook_bad_json", "Request body must be a JSON object.");
    }
    if (outcome.status === "rejected") {
      c.status(401);
    }
    const res: ScheduleWebhookIngressResponse =
      outcome.status === "accepted"
        ? {
            status: "accepted",
            delivery_id: outcome.deliveryId,
            run_id: outcome.runId,
            queued: outcome.queued,
          }
        : outcome.status === "duplicate"
          ? { status: "duplicate", delivery_id: outcome.deliveryId, run_id: outcome.runId }
          : outcome.status === "ignored"
            ? { status: "ignored", delivery_id: outcome.deliveryId, reason: outcome.reason }
            : { status: "rejected", delivery_id: outcome.deliveryId, reason: outcome.reason };
    return c.json(res);
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "WebhookRoutes.routes",
        prefix: "/api/webhooks",
        auth: "none",
        order: 6,
      },
    ],
  },
})
export class WebhookRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly scheduler!: Scheduling;
  @Use() private readonly db!: Db;
  @Bind("WebhookRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    const deps: WebhookRouteDeps = {
      config: this.config,
      scheduler: this.scheduler,
      webhooks: new ScheduleWebhooksRepo(this.db as unknown as DatabaseSync),
      limiter: new WebhookRateLimiter(),
    };
    this.routes = webhookRoutes(deps);
  }
}
