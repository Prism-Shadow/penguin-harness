/**
 * Schedule routes:
 *   GET|POST   /api/projects/:p/agents/:a/schedules
 *   GET|PUT|DELETE /api/projects/:p/agents/:a/schedules/:name (name is the file name)
 * Any member can read; only the owner can modify. The file is declarative intent:
 * POST/PUT fully replace the file, validation always goes through parseScheduleFile
 * (same rules as hand-edited files), and writes take effect immediately via reconciliation.
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { isValidId } from "@prismshadow/penguin-core";
import type { ScheduleItem, ScheduleStatus, SchedulesResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
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
  if (typeof body.enabled !== "boolean") throw badRequest("enabled 必须是布尔值。");
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

/** Displayed status precedence: invalid > done/missed (one-shot) > expired > enabled flag. */
function statusOf(def: ScheduleDefinition, state: ScheduleStateRow, nowMs: number): ScheduleStatus {
  if (state.invalidReason !== null) return "invalid";
  if (def.periodMs === undefined && state.firedOnce) return "done";
  if (def.periodMs === undefined && state.missed) return "missed";
  if (def.endAtMs !== undefined && nowMs > def.endAtMs) return "expired";
  return def.enabled ? "active" : "disabled";
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
    status: statusOf(def, state, nowMs),
    ...(state.invalidReason !== null ? { invalidReason: state.invalidReason } : {}),
    ...(next !== undefined ? { nextFireAt: next } : {}),
    ...(state.lastFiredAt !== null ? { lastFiredAt: state.lastFiredAt } : {}),
    queued,
    ...(state.creatorUserId !== null ? { creatorUserId: state.creatorUserId } : {}),
  };
}

/** Schedule name in the path: same character rules as directories/files, validated before any path construction. */
function requireScheduleName(raw: string | undefined): string {
  if (!raw || !isValidId(raw)) throw badRequest("定时任务名非法。");
  return raw;
}

export function scheduleRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
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
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const body = await readJson(c);
    const name = requireScheduleName(requireString(body, "name", { minLen: 1, maxLen: 100 }));
    if (await readScheduleFile(deps.config.root, projectId, agentId, name)) {
      throw new HttpError(409, "schedule_exists", `定时任务已存在：${name}`);
    }
    await upsert(deps, c.var.user.userId, projectId, agentId, name, body);
    return c.json(await readItem(deps, projectId, agentId, name), 201);
  });

  app.get("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const name = requireScheduleName(c.req.param("name"));
    const item = await readItem(deps, projectId, agentId, name);
    return c.json(item);
  });

  app.put("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const name = requireScheduleName(c.req.param("name"));
    if (!(await readScheduleFile(deps.config.root, projectId, agentId, name))) {
      throw new HttpError(404, "schedule_not_found", `定时任务不存在：${name}`);
    }
    const body = await readJson(c);
    await upsert(deps, c.var.user.userId, projectId, agentId, name, body);
    return c.json(await readItem(deps, projectId, agentId, name));
  });

  app.delete("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const name = requireScheduleName(c.req.param("name"));
    const removed = await deleteScheduleFile(deps.config.root, projectId, agentId, name);
    if (!removed) throw new HttpError(404, "schedule_not_found", `定时任务不存在：${name}`);
    deps.scheduler.dropEntry(projectId, agentId, name);
    return c.body(null, 204);
  });

  return app;
}

/** Write + register creator + reconcile immediately (API changes take effect right away). */
async function upsert(
  deps: AppDeps,
  userId: string,
  projectId: string,
  agentId: string,
  name: string,
  body: Record<string, unknown>,
): Promise<void> {
  const fields = parseUpsertBody(body);
  const raw = serializeSchedule(fields);
  const parsed = parseScheduleFile(name, raw);
  if (!parsed.ok) throw badRequest(`定时任务配置非法：${parsed.error}`);
  // At save time, verify the model reference resolves (resolveModelRef semantics; same rules as reconciliation) so we never persist a broken file.
  const refError = await validateScheduleModelRef(deps.config.root, projectId, parsed.def);
  if (refError !== null) throw badRequest(`定时任务配置非法：${refError}`);
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
  deps: AppDeps,
  projectId: string,
  agentId: string,
  name: string,
): Promise<ScheduleItem> {
  const { entries, invalid } = await deps.scheduler.listAgent(projectId, agentId);
  const entry = entries.find((e) => e.def.name === name);
  if (entry) return toItem(entry.def, entry.state, entry.queued, Date.now());
  const bad = invalid.find((i) => i.name === name);
  if (bad) throw badRequest(`定时任务文件非法：${bad.error}`);
  throw new HttpError(404, "schedule_not_found", `定时任务不存在：${name}`);
}
