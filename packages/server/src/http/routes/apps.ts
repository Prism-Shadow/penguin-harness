/**
 * App Center routes:
 *   GET|POST       /api/projects/:p/apps          (GET ?refresh=1 re-probes every status)
 *   GET|PUT|DELETE /api/projects/:p/apps/:id      (id is the file name)
 *   POST           /api/projects/:p/apps/:id/actions   { action: "restart" | "stop" }
 * Any member can read and send actions; registering, editing and unregistering are
 * owner-only, like schedules. The file is the truth: POST/PUT fully replace it, validation
 * always goes through parseAppFile (the rules a hand-edited file meets), and the response is
 * read back from disk. An action composes the `[app_center]` user input and hands it to the
 * owning Session the way a typed message would go: steering when a Task is running,
 * otherwise a new Task (queued behind a compaction).
 */
import { Hono } from "hono";
import { isValidId, userText } from "@prismshadow/penguin-core";
import type {
  AppActionResponse,
  AppItem,
  AppKind,
  AppsResponse,
  SessionStatus,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { HttpError } from "../errors.js";
import {
  badRequest,
  optionalEnum,
  optionalString,
  readJson,
  requireEnum,
  requireString,
  requireValidId,
} from "../validate.js";
import { composeAppActionMessage } from "../../runtime/app-actions.js";
import {
  APP_KINDS,
  deleteAppFile,
  listAppFiles,
  parseAppFile,
  readAppFile,
  serializeApp,
  slugifyAppId,
  writeAppFile,
} from "../../runtime/app-registry.js";
import type { AppDefinition, AppFileEntry } from "../../runtime/app-registry.js";
import { recallStoreOf } from "../../runtime/session-manager.js";

/** Body fields of POST / PUT, shaped for the file (semantic validation is parseAppFile's). */
interface UpsertFields {
  name: string;
  description?: string;
  sessionId: string;
  agentId?: string;
  workspace?: string;
  url?: string;
  healthUrl?: string;
  startCommand?: string;
  stopCommand?: string;
  kind: AppKind;
}

function parseUpsertBody(body: Record<string, unknown>): UpsertFields {
  const text = { minLen: 1, maxLen: 4096 };
  const name = requireString(body, "name", { minLen: 1, maxLen: 200 });
  const description = optionalString(body, "description", { minLen: 1, maxLen: 2000 });
  const sessionId = requireString(body, "sessionId", { minLen: 1, maxLen: 200 });
  const agentId = optionalString(body, "agentId", { minLen: 1, maxLen: 200 });
  const workspace = optionalString(body, "workspace", text);
  const url = optionalString(body, "url", text);
  const healthUrl = optionalString(body, "healthUrl", text);
  const startCommand = optionalString(body, "startCommand", text);
  const stopCommand = optionalString(body, "stopCommand", text);
  const kind = optionalEnum(body, "kind", APP_KINDS) ?? "web";
  return {
    name,
    ...(description !== undefined ? { description } : {}),
    sessionId,
    ...(agentId !== undefined ? { agentId } : {}),
    ...(workspace !== undefined ? { workspace } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(healthUrl !== undefined ? { healthUrl } : {}),
    ...(startCommand !== undefined ? { startCommand } : {}),
    ...(stopCommand !== undefined ? { stopCommand } : {}),
    kind,
  };
}

/** App id in the path or body: the file-name character rule, checked before any path is built. */
function requireAppId(raw: string | undefined): string {
  if (!raw || !isValidId(raw)) throw badRequest("Invalid app id.");
  return raw;
}

export function appRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const force = c.req.query("refresh") === "1";
    const entries = await listAppFiles(deps.config.root, projectId);
    const res: AppsResponse = {
      apps: await Promise.all(
        entries.flatMap((e) =>
          e.parsed.ok ? [toItem(deps, projectId, e, e.parsed.def, force)] : [],
        ),
      ),
      invalidFiles: entries.flatMap((e) =>
        e.parsed.ok ? [] : [{ id: e.id, error: e.parsed.error }],
      ),
    };
    return c.json(res);
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const fields = parseUpsertBody(body);
    // An explicit id must be free; a derived one is made unique by a counter suffix.
    let id: string;
    if (body.id !== undefined) {
      id = requireAppId(requireString(body, "id", { minLen: 1, maxLen: 100 }));
      if (await readAppFile(deps.config.root, projectId, id)) {
        throw new HttpError(409, "app_exists", `App already exists: ${id}`);
      }
    } else {
      const base = slugifyAppId(fields.name);
      id = base;
      for (let n = 2; await readAppFile(deps.config.root, projectId, id); n += 1) {
        id = `${base}-${n}`;
      }
    }
    const now = new Date().toISOString();
    await write(deps, projectId, id, fields, { registeredAt: now, updatedAt: now });
    return c.json(await readItem(deps, projectId, id), 201);
  });

  app.get("/:id", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const id = requireAppId(c.req.param("id"));
    return c.json(await readItem(deps, projectId, id, c.req.query("refresh") === "1"));
  });

  app.put("/:id", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const id = requireAppId(c.req.param("id"));
    const existing = await readAppFile(deps.config.root, projectId, id);
    if (!existing) throw new HttpError(404, "app_not_found", `App does not exist: ${id}`);
    const body = await readJson(c);
    const fields = parseUpsertBody(body);
    // The registration time survives an edit; an unreadable old file gets stamped afresh.
    const registeredAt =
      (existing.parsed.ok ? existing.parsed.def.registeredAt : undefined) ??
      new Date(existing.mtimeMs).toISOString();
    if (existing.parsed.ok) deps.appProbe.invalidate(probeUrl(existing.parsed.def));
    await write(deps, projectId, id, fields, { registeredAt, updatedAt: new Date().toISOString() });
    return c.json(await readItem(deps, projectId, id));
  });

  app.delete("/:id", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const id = requireAppId(c.req.param("id"));
    const existing = await readAppFile(deps.config.root, projectId, id);
    if (!existing) throw new HttpError(404, "app_not_found", `App does not exist: ${id}`);
    if (existing.parsed.ok) deps.appProbe.invalidate(probeUrl(existing.parsed.def));
    await deleteAppFile(deps.config.root, projectId, id);
    return c.body(null, 204);
  });

  app.post("/:id/actions", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const id = requireAppId(c.req.param("id"));
    const body = await readJson(c);
    const action = requireEnum(body, "action", ["restart", "stop"] as const);
    const def = await readDefinition(deps, projectId, id);
    const row = deps.sessionsRepo.findById(def.sessionId);
    if (!row || row.projectId !== projectId) {
      throw new HttpError(
        409,
        "app_session_missing",
        `The Session this app was registered from no longer exists: ${def.sessionId}. Register the app again from a live conversation.`,
      );
    }
    // sender "server": in the Trace this user turn was composed by the App Center, not typed.
    const input = [userText(composeAppActionMessage(def, action), "server")];
    const status: SessionStatus = deps.manager.statusOf(row.sessionId);
    if (status === "running") {
      try {
        deps.manager.steer(row.sessionId, input, recallStoreOf(input));
        return c.json(
          { sessionId: row.sessionId, delivery: "steer" } satisfies AppActionResponse,
          202,
        );
      } catch (err) {
        // The Task ended between the status read and the steer: fall through to a new Task.
        if (!(err instanceof HttpError && err.code === "not_running")) throw err;
      }
    }
    const started = await deps.manager.startTask(row.sessionId, input, { queueIfBusy: true });
    return c.json(
      {
        sessionId: started.sessionId,
        delivery: started.queued ? "queued" : "task",
      } satisfies AppActionResponse,
      202,
    );
  });

  return app;
}

function probeUrl(def: AppDefinition): string | undefined {
  return def.healthUrl ?? def.url;
}

/**
 * Serialize + parse-check + write. `agentId` / `workspace` default to the owning Session's
 * values, which is what the CLI inside a conversation and the web form both mean; the Session
 * must exist in this Project, so an app never points at a conversation nobody can open.
 */
async function write(
  deps: AppDeps,
  projectId: string,
  id: string,
  fields: UpsertFields,
  stamps: { registeredAt: string; updatedAt: string },
): Promise<void> {
  const row = deps.sessionsRepo.findById(fields.sessionId);
  if (!row || row.projectId !== projectId) {
    throw new HttpError(
      400,
      "app_session_unknown",
      `sessionId must name a Session of this Project: ${fields.sessionId}`,
    );
  }
  const raw = serializeApp({
    ...fields,
    agentId: fields.agentId ?? row.agentId,
    workspace: fields.workspace ?? row.workspace,
    ...stamps,
  });
  const parsed = parseAppFile(id, raw);
  if (!parsed.ok) throw badRequest(`Invalid app registration: ${parsed.error}`);
  await writeAppFile(deps.config.root, projectId, id, raw);
}

async function readDefinition(
  deps: AppDeps,
  projectId: string,
  id: string,
): Promise<AppDefinition> {
  const entry = await readAppFile(deps.config.root, projectId, id);
  if (!entry) throw new HttpError(404, "app_not_found", `App does not exist: ${id}`);
  if (!entry.parsed.ok) throw badRequest(`Invalid app file: ${entry.parsed.error}`);
  return entry.parsed.def;
}

async function readItem(
  deps: AppDeps,
  projectId: string,
  id: string,
  force = false,
): Promise<AppItem> {
  const entry = await readAppFile(deps.config.root, projectId, id);
  if (!entry) throw new HttpError(404, "app_not_found", `App does not exist: ${id}`);
  if (!entry.parsed.ok) throw badRequest(`Invalid app file: ${entry.parsed.error}`);
  return toItem(deps, projectId, entry, entry.parsed.def, force);
}

/** The API view of one file: definition + owning-Session facts + the probed status. */
async function toItem(
  deps: AppDeps,
  projectId: string,
  entry: AppFileEntry,
  def: AppDefinition,
  force: boolean,
): Promise<AppItem> {
  const row = deps.sessionsRepo.findById(def.sessionId);
  const probe = await deps.appProbe.status(probeUrl(def), { force });
  const fallbackAt = new Date(entry.mtimeMs).toISOString();
  return {
    id: def.id,
    name: def.name,
    ...(def.description !== undefined ? { description: def.description } : {}),
    sessionId: def.sessionId,
    ...(row?.title ? { sessionTitle: row.title } : {}),
    sessionExists: row !== null && row.projectId === projectId,
    agentId: def.agentId,
    workspace: def.workspace,
    ...(def.url !== undefined ? { url: def.url } : {}),
    ...(def.healthUrl !== undefined ? { healthUrl: def.healthUrl } : {}),
    ...(def.startCommand !== undefined ? { startCommand: def.startCommand } : {}),
    ...(def.stopCommand !== undefined ? { stopCommand: def.stopCommand } : {}),
    kind: def.kind,
    registeredAt: def.registeredAt ?? fallbackAt,
    updatedAt: def.updatedAt ?? def.registeredAt ?? fallbackAt,
    status: probe.status,
    ...(probe.checkedAt !== undefined ? { checkedAt: probe.checkedAt } : {}),
  };
}
