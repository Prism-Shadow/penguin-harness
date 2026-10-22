/**
 * Schedule routes:
 *   GET|POST   /api/projects/:p/agents/:a/schedules
 *   POST       /api/projects/:p/agents/:a/schedules/template-placeholder  # insert the {{SCHEDULES}} placeholder
 *   GET|PUT|DELETE /api/projects/:p/agents/:a/schedules/:name (name is the file name)
 *   POST       /api/projects/:p/agents/:a/schedules/:name/fire  # fire once now (an extra run; never consumes the schedule)
 *   POST|GET|PUT|DELETE /api/projects/:p/agents/:a/schedules/:name/webhook  # trigger mgmt
 *   POST       /api/projects/:p/agents/:a/schedules/:name/webhook/rotate
 *   GET        /api/projects/:p/agents/:a/schedules/:name/webhook/deliveries
 *   POST       .../deliveries/:deliveryId/replay
 * The public ingress lives in routes/webhooks.ts (POST /api/webhooks/schedules/:token).
 *   GET        /api/projects/:p/schedules  # every Agent's tasks in the Project, in one list
 * Any member can read; only the owner can modify. The file is declarative intent:
 * POST/PUT fully replace the file, validation always goes through parseScheduleFile
 * (same rules as hand-edited files), and writes take effect immediately via reconciliation.
 * Two writes are refused: any task whose end_at is already past (it could never fire, and the
 * scheduler would archive it the moment it landed), and a one-shot whose start_at is already
 * past (it would fire immediately; "run once now" is not offered — user decision 2026-10-15).
 * Settled tasks are archived by the scheduler, so no listing here ever shows one.
 */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { isValidId } from "@prismshadow/penguin-core";
import type {
  ProjectSchedulesResponse,
  ScheduleItem,
  SchedulesResponse,
  ScheduleFireResponse,
  ScheduleWebhookDeliveryListResponse,
  ScheduleWebhookSecretView,
  ScheduleWebhookView,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { ServerConfig } from "../../config.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface SchedulesRouteDeps {
  agentConfigService: AgentConfig;
  config: ServerConfig;
  projectConfigService: ProjectConfigStore;
  access: Access;
  scheduler: Scheduling;
  schedulesRepo: Schedules;
  webhooks: ScheduleWebhooksRepo;
}
import { HttpError } from "../errors.js";
import {
  badRequest,
  optionalString,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";
import type { ScheduleDefinition } from "../../runtime/schedule-file.js";
import {
  latestSlotAt,
  nextSlotAfter,
  parseScheduleFile,
  slotInWindow,
} from "../../runtime/schedule-file.js";
import type { ScheduleStateRow } from "../../db/repos/schedules.js";
import {
  deleteScheduleFile,
  readScheduleFile,
  serializeSchedule,
  validateScheduleModelRef,
  writeScheduleFile,
} from "../../runtime/schedule-store.js";
import { scheduleStatus, ScheduleFireError } from "../../runtime/scheduler.js";
import {
  isWebhookProvider,
  mintWebhookId,
  mintWebhookToken,
  replayWebhookDelivery,
  secretHint,
  webhookPath,
} from "../../runtime/schedule-webhooks.js";
import type { WebhookTriggerRow } from "../../db/repos/schedule-webhooks.js";
import { ScheduleWebhooksRepo } from "../../db/repos/schedule-webhooks.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Config, Db } from "../../hmr/capabilities.js";
import type { Access, ProjectConfigStore } from "../../mechanisms/projects.js";
import type { Schedules, Scheduling } from "../../mechanisms/sessions.js";
import type { AgentConfig } from "../../mechanisms/agents.js";

/** Validate and shape the POST/PUT request body into file fields (semantic validation is left to parseScheduleFile). */
function parseUpsertBody(body: Record<string, unknown>): {
  prompt: string;
  enabled: boolean;
  startAt: string;
  period?: string;
  endAt?: string;
  sessionId?: string;
  workspace?: string;
  modelId?: string;
  provider?: string;
} {
  if (typeof body.enabled !== "boolean") throw badRequest("enabled must be a boolean.");
  const prompt = requireString(body, "prompt", { minLen: 1, maxLen: 100_000 });
  const startAt = requireString(body, "startAt", { minLen: 1, maxLen: 100 });
  const period = optionalString(body, "period", { minLen: 1, maxLen: 20 });
  const endAt = optionalString(body, "endAt", { minLen: 1, maxLen: 100 });
  const sessionId = optionalString(body, "sessionId", { minLen: 1, maxLen: 200 });
  const workspace = optionalString(body, "workspace", { minLen: 1, maxLen: 4096 });
  const modelId = optionalString(body, "modelId", { minLen: 1, maxLen: 200 });
  const provider = optionalString(body, "provider", { minLen: 1, maxLen: 64 });
  return {
    prompt,
    enabled: body.enabled,
    startAt,
    ...(period !== undefined ? { period } : {}),
    ...(endAt !== undefined ? { endAt } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(workspace !== undefined ? { workspace } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
    ...(provider !== undefined ? { provider } : {}),
  };
}

/** Next scheduled fire time: none when disabled/invalid/done/missed; an undigested due slot counts as-is. */
function nextFireAt(
  def: ScheduleDefinition,
  state: ScheduleStateRow,
  nowMs: number,
): string | undefined {
  if (!def.enabled || state.invalidReason !== null) return undefined;
  if (def.periodMs === undefined && (state.firedOnce || state.missed)) return undefined;
  const due = latestSlotAt(def, nowMs);
  if (
    due !== null &&
    slotInWindow(def, due) &&
    (state.lastSlotMs === null || due > state.lastSlotMs)
  ) {
    return new Date(due).toISOString();
  }
  const next = nextSlotAfter(def, nowMs);
  return next !== null ? new Date(next).toISOString() : undefined;
}

function toItem(
  def: ScheduleDefinition,
  state: ScheduleStateRow,
  queued: boolean,
  nowMs: number,
): ScheduleItem {
  const next = nextFireAt(def, state, nowMs);
  return {
    name: def.name,
    prompt: def.prompt,
    enabled: def.enabled,
    startAt: def.startAt,
    ...(def.period !== undefined ? { period: def.period } : {}),
    ...(def.endAt !== undefined ? { endAt: def.endAt } : {}),
    ...(def.sessionId !== undefined ? { sessionId: def.sessionId } : {}),
    ...(def.workspace !== undefined ? { workspace: def.workspace } : {}),
    ...(def.modelId !== undefined ? { modelId: def.modelId } : {}),
    ...(def.provider !== undefined ? { provider: def.provider } : {}),
    status: scheduleStatus(def, state, nowMs),
    ...(state.invalidReason !== null ? { invalidReason: state.invalidReason } : {}),
    ...(next !== undefined ? { nextFireAt: next } : {}),
    ...(state.lastFiredAt !== null ? { lastFiredAt: state.lastFiredAt } : {}),
    queued,
    ...(state.creatorUserId !== null ? { creatorUserId: state.creatorUserId } : {}),
  };
}

/** Schedule name in the path: same character rules as directories/files, validated before any path construction. */
function requireScheduleName(raw: string | undefined): string {
  if (!raw || !isValidId(raw)) throw badRequest("Invalid schedule name.");
  return raw;
}

/**
 * A webhook HMAC secret from the body: absent on create means bearer-only; null on
 * update clears it back to bearer-only. Present secrets run 8..500 chars — shorter
 * ones are typos, and the HMAC input is capped like every other request field.
 */
function readWebhookSecret(value: unknown, allowNull: boolean): string | null {
  if (value === undefined) return null;
  if (value === null && allowNull) return null;
  if (typeof value !== "string" || value.length < 8 || value.length > 500) {
    throw badRequest("secret must be a string 8..500 chars long.");
  }
  return value;
}

/** A bearer token no trigger holds: 192 bits of random per try, three tries. */
function mintUniqueToken(deps: SchedulesRouteDeps, tries: number): string {
  for (let i = 0; i < tries; i++) {
    const token = mintWebhookToken();
    if (deps.webhooks.getTriggerByToken(token) === null) return token;
  }
  throw new HttpError(500, "webhook_token_mint_failed", "Could not mint a unique webhook token.");
}

function toWebhookView(trigger: WebhookTriggerRow): ScheduleWebhookView {
  return {
    provider: trigger.provider,
    enabled: trigger.enabled,
    // Redacted: the path embeds the bearer token, so reading it would be reading
    // the credential. Creation and rotation are the only answers that carry it.
    path: "",
    hasSecret: trigger.secret !== null,
    secretHint: trigger.secret === null ? null : secretHint(trigger.secret),
    lastFiredAt: trigger.lastFiredAt,
  };
}

function toWebhookSecretView(trigger: WebhookTriggerRow, token: string): ScheduleWebhookSecretView {
  return { ...toWebhookView(trigger), path: webhookPath(token), token };
}

export function scheduleRoutes(deps: SchedulesRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const { entries, invalid } = await deps.scheduler.listAgent(projectId, agentId);
    const nowMs = Date.now();
    const res: SchedulesResponse = {
      schedules: entries.map((e) => toItem(e.def, e.state, e.queued, nowMs)),
      invalidFiles: invalid,
    };
    return c.json(res);
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const body = await readJson(c);
    const name = requireScheduleName(requireString(body, "name", { minLen: 1, maxLen: 100 }));
    if (await readScheduleFile(deps.config.root, projectId, agentId, name)) {
      throw new HttpError(409, "schedule_exists", `Schedule already exists: ${name}`);
    }
    await upsert(deps, c.var.user.userId, projectId, agentId, name, body);
    return c.json(await readItem(deps, projectId, agentId, name), 201);
  });

  // Insert the {{SCHEDULES}} placeholder into the prompt template — the explicit adoption
  // path mirroring memory's endpoint; idempotent config write, owner-level like this
  // router's other mutations. Registered before /:name, though the static path wins anyway.
  app.post("/template-placeholder", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const view = await deps.agentConfigService.insertTemplatePlaceholder(
      projectId,
      agentId,
      "schedules",
    );
    return c.json(view.config.schedules);
  });

  app.get("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const name = requireScheduleName(c.req.param("name"));
    const item = await readItem(deps, projectId, agentId, name);
    return c.json(item);
  });

  app.put("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const name = requireScheduleName(c.req.param("name"));
    if (!(await readScheduleFile(deps.config.root, projectId, agentId, name))) {
      throw new HttpError(404, "schedule_not_found", `Schedule does not exist: ${name}`);
    }
    const body = await readJson(c);
    await upsert(deps, c.var.user.userId, projectId, agentId, name, body);
    return c.json(await readItem(deps, projectId, agentId, name));
  });

  app.delete("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const name = requireScheduleName(c.req.param("name"));
    const removed = await deleteScheduleFile(deps.config.root, projectId, agentId, name);
    if (!removed)
      throw new HttpError(404, "schedule_not_found", `Schedule does not exist: ${name}`);
    deps.scheduler.dropEntry(projectId, agentId, name);
    return c.body(null, 204);
  });

  // Fire once now (a hand trigger): the same dispatch as a due slot, but an extra run
  // that never consumes the schedule — owner-only like every other write, member reads.
  app.post("/:name/fire", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const name = requireScheduleName(c.req.param("name"));
    try {
      const fired = await deps.scheduler.fireNow(projectId, agentId, name);
      const res: ScheduleFireResponse = { sessionId: fired.sessionId, queued: fired.queued };
      return c.json(res);
    } catch (err) {
      if (err instanceof ScheduleFireError) {
        if (err.code === "schedule_not_found") throw new HttpError(404, err.code, err.message);
        if (err.code === "schedule_fire_failed") throw new HttpError(500, err.code, err.message);
        throw new HttpError(400, err.code, err.message);
      }
      throw err;
    }
  });

  // Webhook trigger for one schedule (Multica's "run from a webhook"): the POST below
  // mints the bearer token (returned once — reads redact it), PUT rotates the shape,
  // rotate mints a fresh token, deliveries lists the audit trail, replay re-fires one.
  // Mutations are owner-only like every other write here; reads are member-level.
  app.post("/:name/webhook", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const name = requireScheduleName(c.req.param("name"));
    await readItem(deps, projectId, agentId, name);
    const body = await readJson(c);
    const provider = body.provider ?? "generic";
    if (!isWebhookProvider(provider)) throw badRequest("provider must be generic or github.");
    const secret = readWebhookSecret(body.secret, false);
    if (deps.webhooks.getTrigger(projectId, agentId, name) !== null) {
      throw new HttpError(409, "webhook_exists", `Schedule already has a webhook: ${name}`);
    }
    const now = new Date().toISOString();
    const token = mintUniqueToken(deps, 3);
    deps.webhooks.createTrigger({
      id: mintWebhookId("wht"),
      projectId,
      agentId,
      name,
      token,
      provider,
      secret,
      nowIso: now,
    });
    const created = deps.webhooks.getTrigger(projectId, agentId, name)!;
    return c.json(toWebhookSecretView(created, token), 201);
  });

  app.get("/:name/webhook", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const name = requireScheduleName(c.req.param("name"));
    const trigger = deps.webhooks.getTrigger(projectId, agentId, name);
    if (trigger === null)
      throw new HttpError(404, "webhook_not_found", "No webhook on this schedule.");
    return c.json(toWebhookView(trigger));
  });

  app.put("/:name/webhook", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const name = requireScheduleName(c.req.param("name"));
    const trigger = deps.webhooks.getTrigger(projectId, agentId, name);
    if (trigger === null)
      throw new HttpError(404, "webhook_not_found", "No webhook on this schedule.");
    const body = await readJson(c);
    const patch: { provider?: "generic" | "github"; secret?: string | null; enabled?: boolean } =
      {};
    if (body.provider !== undefined) {
      if (!isWebhookProvider(body.provider))
        throw badRequest("provider must be generic or github.");
      patch.provider = body.provider;
    }
    if (body.secret !== undefined) patch.secret = readWebhookSecret(body.secret, true);
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") throw badRequest("enabled must be a boolean.");
      patch.enabled = body.enabled;
    }
    deps.webhooks.updateTrigger(trigger.id, patch, new Date().toISOString());
    return c.json(toWebhookView(deps.webhooks.getTrigger(projectId, agentId, name)!));
  });

  app.post("/:name/webhook/rotate", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const name = requireScheduleName(c.req.param("name"));
    const trigger = deps.webhooks.getTrigger(projectId, agentId, name);
    if (trigger === null)
      throw new HttpError(404, "webhook_not_found", "No webhook on this schedule.");
    const token = mintUniqueToken(deps, 3);
    deps.webhooks.rotateToken(trigger.id, token, new Date().toISOString());
    const rotated = deps.webhooks.getTrigger(projectId, agentId, name)!;
    return c.json(toWebhookSecretView(rotated, token));
  });

  app.delete("/:name/webhook", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const name = requireScheduleName(c.req.param("name"));
    const trigger = deps.webhooks.getTrigger(projectId, agentId, name);
    if (trigger === null)
      throw new HttpError(404, "webhook_not_found", "No webhook on this schedule.");
    deps.webhooks.deleteTrigger(trigger.id);
    return c.body(null, 204);
  });

  app.get("/:name/webhook/deliveries", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const name = requireScheduleName(c.req.param("name"));
    const trigger = deps.webhooks.getTrigger(projectId, agentId, name);
    if (trigger === null)
      throw new HttpError(404, "webhook_not_found", "No webhook on this schedule.");
    const rawLimit = c.req.query("limit") ?? "50";
    if (!/^\d+$/.test(rawLimit)) throw badRequest("limit must be an integer 1..200.");
    const res: ScheduleWebhookDeliveryListResponse = {
      deliveries: deps.webhooks.listDeliveries(trigger.id, Number(rawLimit)).map((d) => ({
        id: d.id,
        dedupeKey: d.dedupeKey,
        event: d.event,
        signatureStatus: d.signatureStatus,
        status: d.status,
        firingId: d.firingId,
        payload: d.payload,
        createdAt: d.createdAt,
        attemptCount: d.attemptCount,
      })),
    };
    return c.json(res);
  });

  app.post("/:name/webhook/deliveries/:deliveryId/replay", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const name = requireScheduleName(c.req.param("name"));
    const trigger = deps.webhooks.getTrigger(projectId, agentId, name);
    if (trigger === null)
      throw new HttpError(404, "webhook_not_found", "No webhook on this schedule.");
    const delivery = deps.webhooks.getDelivery(requireValidId(c, "deliveryId"));
    if (delivery === null || delivery.triggerId !== trigger.id) {
      throw new HttpError(404, "delivery_not_found", "Delivery does not exist.");
    }
    try {
      const replayed = await replayWebhookDelivery({
        repo: deps.webhooks,
        trigger,
        delivery,
        fire: (p, a, n) => deps.scheduler.fireNow(p, a, n),
        nowIso: new Date().toISOString(),
      });
      return c.json({
        status: "accepted",
        delivery_id: replayed.deliveryId,
        run_id: replayed.runId,
        queued: replayed.queued,
      });
    } catch (err) {
      if (err instanceof ScheduleFireError) {
        if (err.code === "schedule_not_found") throw new HttpError(404, err.code, err.message);
        if (err.code === "schedule_fire_failed") throw new HttpError(500, err.code, err.message);
        throw new HttpError(400, err.code, err.message);
      }
      throw err;
    }
  });

  return app;
}

/**
 * The Project-wide listing. The sidebar's session list draws every Agent's Sessions, so the
 * scheduled-task mark it puts on a row is read from one request that spans the Project instead
 * of one request per Agent — reading a single Agent's list would leave every other row unmarked.
 */
export function projectScheduleRoutes(deps: SchedulesRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const { entries, invalid } = await deps.scheduler.listProject(projectId);
    // One clock reading for the whole response: every row's status and next fire time is derived
    // against the same instant, so a long list cannot straddle a slot boundary.
    const nowMs = Date.now();
    const res: ProjectSchedulesResponse = {
      schedules: entries.map((e) => ({
        agentId: e.agentId,
        ...toItem(e.def, e.state, e.queued, nowMs),
      })),
      invalidFiles: invalid,
    };
    return c.json(res);
  });

  return app;
}

/** Write + register creator + reconcile immediately (API changes take effect right away). */
async function upsert(
  deps: SchedulesRouteDeps,
  userId: string,
  projectId: string,
  agentId: string,
  name: string,
  body: Record<string, unknown>,
): Promise<void> {
  const fields = parseUpsertBody(body);
  const raw = serializeSchedule(fields);
  const parsed = parseScheduleFile(name, raw);
  if (!parsed.ok) throw badRequest(`Invalid schedule configuration: ${parsed.error}`);
  // A one-shot in the past would fire at once (not offered); a past end_at could never fire.
  const nowMs = Date.now();
  if (parsed.def.periodMs === undefined && parsed.def.startAtMs <= nowMs) {
    throw badRequest("start_at is already past: a one-time task needs a future start time.");
  }
  if (parsed.def.endAtMs !== undefined && parsed.def.endAtMs <= nowMs) {
    throw badRequest(
      "end_at is already past: the task would never fire again. Pick a later end time, or delete the task.",
    );
  }
  // At save time, verify the (provider, modelId) pair names a configured model (same rules as reconciliation) so we never persist a broken file.
  // The pairing rule itself is enforced by parseScheduleFile above, which rejects half a reference.
  const refError = await validateScheduleModelRef(deps.projectConfigService, projectId, parsed.def);
  if (refError !== null) throw badRequest(`Invalid schedule configuration: ${refError}`);
  await writeScheduleFile(deps.config.root, projectId, agentId, name, raw);
  // Creator attribution: the API writer is the creator (falls back to the Project owner only for hand-edited files).
  deps.schedulesRepo.registerOrSync({
    projectId,
    agentId,
    name,
    startAtMs: parsed.def.startAtMs,
    defHash: createHash("sha1").update(raw).digest("hex"),
    creatorUserId: userId,
  });
  await deps.scheduler.reconcileAgent(projectId, agentId);
}

async function readItem(
  deps: SchedulesRouteDeps,
  projectId: string,
  agentId: string,
  name: string,
): Promise<ScheduleItem> {
  const { entries, invalid } = await deps.scheduler.listAgent(projectId, agentId);
  const entry = entries.find((e) => e.def.name === name);
  if (entry) return toItem(entry.def, entry.state, entry.queued, Date.now());
  const bad = invalid.find((i) => i.name === name);
  if (bad) throw badRequest(`Invalid schedule file: ${bad.error}`);
  throw new HttpError(404, "schedule_not_found", `Schedule does not exist: ${name}`);
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "SchedulerRoutes.routes",
        prefix: "/api/projects/:projectId/agents/:agentId/schedules",
        auth: "user",
        order: 200,
      },
      {
        id: "SchedulerRoutes.projectRoutes",
        prefix: "/api/projects/:projectId/schedules",
        auth: "user",
        order: 200,
      },
    ],
  },
})
export class SchedulerRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly access!: Access;
  @Use() private readonly scheduler!: Scheduling;
  @Use() private readonly schedulesRepo!: Schedules;
  @Use() private readonly db!: Db;
  @Bind("SchedulerRoutes.routes") routes!: Hono<AppEnv>;
  @Bind("SchedulerRoutes.projectRoutes") projectRoutes!: Hono<AppEnv>;
  setup() {
    const deps: SchedulesRouteDeps = {
      agentConfigService: this.agentConfig,
      config: this.config,
      projectConfigService: this.projectConfig,
      access: this.access,
      scheduler: this.scheduler,
      schedulesRepo: this.schedulesRepo,
      webhooks: new ScheduleWebhooksRepo(this.db as unknown as DatabaseSync),
    };
    this.routes = scheduleRoutes(deps);
    this.projectRoutes = projectScheduleRoutes(deps);
  }
}
