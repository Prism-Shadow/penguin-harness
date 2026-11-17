import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type ProjectConfig } from "@prismshadow/penguin-core";
import type { AppEnv } from "../../auth/middleware.js";
import type { Access, ProjectConfigStore } from "../../mechanisms/projects.js";
import type { SessionIndex } from "../../mechanisms/sessions.js";
import type { CapabilityRuns } from "../../services/capability-runs.js";
import {
  capabilityInput,
  inputText,
  isCapability,
  MAX_AUDIO_BYTES,
  settingsPatch,
} from "../../services/capability-input.js";
import { capabilitySettings, dto } from "../../services/capability-settings.js";
import { badRequest, HttpError } from "../errors.js";
import { pathParam, readJson, requireValidId } from "../validate.js";

interface Dependencies {
  access: Access;
  projects: ProjectConfigStore;
  sessions: SessionIndex;
  runs: CapabilityRuns;
}
function sessionScope(deps: Dependencies, project: string, value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || deps.sessions.findById(value)?.projectId !== project)
    throw new HttpError(404, "session_not_found", "The session does not belong to this project.");
  return value;
}
function pageNumber(raw: string | undefined, defaultValue: number, max: number) {
  if (raw === undefined) return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) throw badRequest("Invalid pagination.");
  return n;
}
function chosenPolish(config: ProjectConfig) {
  if (!config.voice_polish?.enabled)
    throw new HttpError(409, "voice_polish_disabled", "Transcript editing is disabled.");
  const ref = config.voice_polish.model ?? config.default_model;
  if (!ref)
    throw new HttpError(409, "model_unavailable", "Choose a chat model to edit transcripts.");
  const settings = capabilitySettings(config);
  if (
    !settings.candidates.chat.some((r) => r.provider === ref.provider && r.modelId === ref.model_id)
  )
    throw new HttpError(409, "model_unavailable", "The configured model cannot edit text.");
  return dto(ref);
}
export function capabilityRoutes(deps: Dependencies) {
  const app = new Hono<AppEnv>();
  app.use("*", bodyLimit({ maxSize: Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 64 * 1024 }));
  app.use("*", async (c, next) => {
    const project = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, project);
    await next();
  });
  app.get("/", async (c) =>
    c.json(capabilitySettings(await deps.projects.loadConfig(requireValidId(c, "projectId")))),
  );
  app.patch("/", async (c) => {
    const project = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, project);
    return c.json(
      await deps.projects.patchCapabilitySettings(project, settingsPatch(await readJson(c))),
    );
  });
  app.get("/usage", (c) => {
    const project = requireValidId(c, "projectId");
    const session = sessionScope(deps, project, c.req.query("sessionId"));
    const limit = pageNumber(c.req.query("limit"), 50, 200);
    const offset = pageNumber(c.req.query("offset"), 0, Number.MAX_SAFE_INTEGER);
    return c.json({
      runs: deps.runs
        .list(project, session, limit, offset)
        .map(({ text: _text, sources: _sources, ...usage }) => usage),
    });
  });
  app.get("/artifacts", (c) => {
    const project = requireValidId(c, "projectId");
    const session = sessionScope(deps, project, c.req.query("sessionId"));
    return c.json({
      artifacts: deps.runs.artifacts(
        project,
        session,
        pageNumber(c.req.query("limit"), 50, 200),
        pageNumber(c.req.query("offset"), 0, Number.MAX_SAFE_INTEGER),
      ),
    });
  });
  app.get("/artifacts/:id", async (c) => {
    const { item, bytes } = await deps.runs.file(
      requireValidId(c, "projectId"),
      pathParam(c, "id"),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": item.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": 'inline; filename="' + item.name + '"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  });
  app.get("/runs/:id", (c) =>
    c.json(deps.runs.get(requireValidId(c, "projectId"), pathParam(c, "id"))),
  );
  app.delete("/runs/:id", (c) =>
    c.json(deps.runs.cancel(requireValidId(c, "projectId"), pathParam(c, "id"))),
  );
  app.post("/:capability/run", async (c) => {
    const key = pathParam(c, "capability");
    if (!isCapability(key)) throw badRequest("Unknown capability.");
    const project = requireValidId(c, "projectId");
    const body = await readJson(c);
    const session = sessionScope(deps, project, body.sessionId);
    const { item, options } = capabilityInput(key, body);
    const config = await deps.projects.loadConfig(project);
    const { bindings, candidates } = capabilitySettings(config);
    const model = bindings[key];
    if (
      !model ||
      !candidates[key].some((m) => m.provider === model.provider && m.modelId === model.modelId)
    )
      throw new HttpError(
        409,
        "capability_unbound",
        "Bind a project model that supports " + key + " first.",
      );
    const bg = body.async === true;
    const result = await deps.runs.run(
      { projectId: project, sessionId: session, capability: key, model, config, item, options },
      c.req.raw.signal,
      bg,
    );
    if (!bg && result.status === "failed")
      throw new HttpError(502, "capability_failed", result.error!);
    return c.json(result, bg ? 202 : 200);
  });
  return app;
}
export function voicePolishRoutes(deps: Dependencies) {
  const app = new Hono<AppEnv>();
  app.post("/", async (c) => {
    const project = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, project);
    const body = await readJson(c);
    const session = sessionScope(deps, project, body.sessionId);
    const text = inputText(body.text);
    const config = await deps.projects.loadConfig(project);
    const model = chosenPolish(config);
    const result = await deps.runs.run(
      {
        projectId: project,
        sessionId: session,
        capability: "voice-polish",
        model,
        config,
        item: { type: "text.done", text },
        options: {},
      },
      c.req.raw.signal,
      false,
    );
    if (result.status !== "completed")
      throw new HttpError(502, "voice_polish_failed", result.error ?? "Transcript editing failed.");
    return c.json({ text: result.text!, model: result.model, usage: result.usage });
  });
  return app;
}
