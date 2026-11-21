/**
 * Schedule routes, as pure factories over structural ports (services+http+cli restack S7):
 *   GET|POST   /api/projects/:p/agents/:a/schedules
 *   POST       /api/projects/:p/agents/:a/schedules/template-placeholder  # insert the {{SCHEDULES}} placeholder
 *   GET|PUT|DELETE /api/projects/:p/agents/:a/schedules/:name (name is the file name)
 *   GET        /api/projects/:p/schedules  # every Agent's tasks in the Project, in one list
 * Any member can read; only the owner can modify. The file is declarative intent:
 * POST/PUT fully replace the file, validation always goes through parseScheduleFile
 * (same rules as hand-edited files), and writes take effect immediately via reconciliation.
 * Two writes are refused: any task whose end_at is already past (it could never fire, and the
 * scheduler would archive it the moment it landed), and a one-shot whose start_at is already
 * past (it would fire immediately; "run once now" is not offered — user decision 2026-10-15).
 * Settled tasks are archived by the scheduler, so no listing here ever shows one.
 *
 * The ports the factories reach — the agent-config surface, the access check and the data
 * root — are declared here at the consumer (Go style); the server binds them to its own
 * mechanisms in its assembly (see packages/server). This package never imports the server.
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { isValidId } from "@prismshadow/penguin-core";
import { HttpError } from "@prismshadow/penguin-library-http";
import {
  badRequest,
  optionalString,
  readJson,
  requireString,
  requireValidId,
} from "@prismshadow/penguin-library-http/validate";
import type { AppEnv } from "@prismshadow/penguin-library-http";
import type { AgentConfigView } from "@prismshadow/penguin-library-agent/types";
import type { Schedules, Scheduling } from "./session.js";
import type { ScheduleStateRow } from "./repos/schedules.js";
import {
  deleteScheduleFile,
  readScheduleFile,
  serializeSchedule,
  validateScheduleModelRef,
  writeScheduleFile,
  type ScheduleConfigSource,
} from "./schedule-store.js";
import type { ScheduleDefinition } from "./schedule-file.js";
import {
  latestSlotAt,
  nextSlotAfter,
  parseScheduleFile,
  slotInWindow,
} from "./schedule-file.js";
import { scheduleStatus } from "./schedules-status.js";

// ---------------------------------------------------------------------------
// Response vocabulary (was api/types.ts's; the routes read and write it, so the
// words live with the routes)
// ---------------------------------------------------------------------------

/**
 * Display-facing schedule status: the file's `enabled` only expresses intent; the rest is derived from runtime state.
 * The scheduler archives an agent's settled tasks (done / missed / expired) into `schedule/expired/`, so the agent
 * listings show those three only while a queued fire is still to be sent or when the move failed.
 */
export type ScheduleStatus = "active" | "disabled" | "expired" | "done" | "missed" | "invalid";

export interface ScheduleItem {
  /** Filename (without .toml) is the identifier. */
  name: string;
  prompt: string;
  enabled: boolean;
  /** ISO 8601. */
  startAt: string;
  /** Raw fixed interval (e.g. `30m`); unset means a one-off task. */
  period?: string;
  endAt?: string;
  /** Bound target Session; defaults to creating a new Session each time. */
  sessionId?: string;
  workspace?: string;
  /** Model for new-Session mode (upstream id, always paired with provider); absent means the Project's default reference. */
  modelId?: string;
  /** Provider group for `modelId`; present exactly when `modelId` is — a model reference is always a pair. */
  provider?: string;
  status: ScheduleStatus;
  invalidReason?: string;
  /** Next scheduled fire time (ISO 8601); unset when done/missed/invalid/disabled. */
  nextFireAt?: string;
  /** Most recent actual fire time (ISO 8601). */
  lastFiredAt?: string;
  /** Queued, waiting for the target Session to become idle. */
  queued: boolean;
  creatorUserId?: string;
}

export interface SchedulesResponse {
  schedules: ScheduleItem[];
  /** Files that failed to parse (skipped from scheduling and logged as errors). */
  invalidFiles: Array<{ name: string; error: string }>;
}

/**
 * One task in the Project-wide listing (GET /api/projects/:projectId/schedules): the agent's
 * item plus the agent whose schedule directory holds it, since the list spans every agent.
 */
export interface ProjectScheduleItem extends ScheduleItem {
  agentId: string;
}

export interface ProjectSchedulesResponse {
  /** Every agent's tasks: agents in id order, each agent's tasks in the order its own listing returns them. */
  schedules: ProjectScheduleItem[];
  /** Files that failed to parse (skipped from scheduling and logged as errors), with the agent that holds each. */
  invalidFiles: Array<{ agentId: string; name: string; error: string }>;
}

export interface ScheduleUpsertRequest {
  prompt: string;
  enabled: boolean;
  startAt: string;
  period?: string;
  endAt?: string;
  sessionId?: string;
  workspace?: string;
  /** Model for new-Session mode (upstream id); always sent together with provider, omit both for the Project's default reference. */
  modelId?: string;
  /**
   * Provider group for `modelId`. Both fields are sent as a pair (400 otherwise); the
   * pair is checked against the Project config at save/reconciliation time.
   */
  provider?: string;
}

// ---------------------------------------------------------------------------
// Structural ports (the server binds them to its own mechanisms)
// ---------------------------------------------------------------------------

/** What the routes need of the agent-config surface (the server's `AgentConfig` satisfies this). */
export interface SchedulesAgentConfig {
  requireExists(projectId: string, agentId: string): Promise<void>;
  insertTemplatePlaceholder(
    projectId: string,
    agentId: string,
    feature: "vault" | "skills" | "schedules",
  ): Promise<AgentConfigView>;
}

/** Who may read and who may write (the server's `Access` satisfies this). */
export interface SchedulesAccess {
  requireProjectAccess(userId: string, projectId: string): void;
  requireProjectOwner(userId: string, projectId: string): void;
}

/** The data root, as the schedule file paths want it (the server's `Config`/`ServerConfig` satisfies this). */
export interface SchedulesRoot {
  root: string;
}

/** What this route group reaches — bound by its module (src/modules). */
export interface SchedulesRouteDeps {
  agentConfigService: SchedulesAgentConfig;
  config: SchedulesRoot;
  projectConfigService: ScheduleConfigSource;
  access: SchedulesAccess;
  scheduler: Scheduling;
  schedulesRepo: Schedules;
}

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

/** One task's item, read through the scheduler's runtime view (an unparsable file is an error item, not a 404). */
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


