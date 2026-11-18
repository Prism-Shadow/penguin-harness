import { getModel, modelOperation } from "@prismshadow/penguin-core";
import { estimateImageToolCost } from "../services/capability-cost.js";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ModelOperation as Capability, CapabilityCliReply } from "../api/capabilities.js";
import { parseModelTool, requestFromCommand } from "./model-tool-grammar.js";
import type { AppEnv } from "../auth/middleware.js";
import type { Access, ProjectConfigStore } from "../mechanisms/projects.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { ModelCapabilities } from "./model-capabilities.js";
import type { CapabilityRuns } from "../services/capability-runs.js";
import {
  inputText,
  capabilityInput,
  MAX_AUDIO_BYTES,
  settingsPatch,
} from "../services/capability-input.js";
import {
  dto,
  canonicalToolSettings,
  legacyToolSettings,
  capabilitySettings,
  projectCapabilities,
} from "../services/capability-settings.js";
import { requireDeepSeekAudio } from "../services/transcription-audio.js";
import { badRequest, HttpError } from "../http/errors.js";
import { pathParam, readJson, requireValidId } from "../http/validate.js";

export interface CapabilityDependencies {
  capabilities: ModelCapabilities;
  access: Access;
  projects: ProjectConfigStore;
  sessions: SessionIndex;
  runs: CapabilityRuns;
}
export function sessionScope(deps: CapabilityDependencies, project: string, value: unknown) {
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
function unavailable(key: string) {
  return new HttpError(
    409,
    "capability_unavailable",
    `No enabled plugin provides ${key} for this project.`,
  );
}
export function capabilityRoutes(deps: CapabilityDependencies) {
  const app = new Hono<AppEnv>();
  app.use("*", bodyLimit({ maxSize: Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 64 * 1024 }));
  app.use("*", async (c, next) => {
    const project = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, project);
    await next();
  });
  const settings = async (project: string) =>
    projectCapabilities(
      await deps.projects.loadConfig(project),
      await deps.capabilities.list(project),
    );
  app.get("/", async (c) =>
    c.json(legacyToolSettings(await settings(requireValidId(c, "projectId")))),
  );
  app.get("/tools", async (c) =>
    c.json(canonicalToolSettings(await settings(requireValidId(c, "projectId")))),
  );
  const patchSettings = async (c: Context<AppEnv>, canonical: boolean) => {
    const project = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, project);
    const patch = settingsPatch(await readJson(c));
    const available = await deps.capabilities.list(project);
    // Older Web Apps offered "use the default chat model" for editing. Resolve that choice
    // once to the project text tool, so a later change of chat model can't change the tool.
    if (
      !canonical &&
      patch.voicePolish?.enabled &&
      patch.bindings?.t2t === undefined &&
      !patch.voicePolish.model
    ) {
      const config = await deps.projects.loadConfig(project);
      if ((patch.voicePolish.model === null || !config.tools?.t2t) && config.default_model)
        patch.voicePolish.model = dto(config.default_model);
    }
    const requested = Object.keys(patch.bindings ?? {});
    if (patch.voicePolish?.model || patch.voicePolish?.enabled) requested.push("t2t");
    for (const key of requested) {
      if (!available.some((c) => c.key === key)) throw unavailable(key);
    }
    await deps.projects.patchCapabilitySettings(project, patch);
    const current = await settings(project);
    return c.json(canonical ? canonicalToolSettings(current) : legacyToolSettings(current));
  };
  app.patch("/", (c) => patchSettings(c, false));
  app.patch("/tools", (c) => patchSettings(c, true));
  const usage = async (
    project: string,
    session: string | undefined,
    limit: number,
    offset: number,
  ) => {
    const config = await deps.projects.loadConfig(project);
    return deps.runs
      .list(project, session, limit, offset)
      .map(({ text: _text, sources: _sources, ...record }) => {
        if (record.capability !== "image") return record;
        const model = getModel(config, {
          provider: record.model.provider,
          model_id: record.model.modelId,
        });
        return { ...record, estimatedCost: estimateImageToolCost(record, model?.pricing) };
      });
  };
  app.get("/usage", async (c) => {
    const project = requireValidId(c, "projectId");
    const session = sessionScope(deps, project, c.req.query("sessionId"));
    const limit = pageNumber(c.req.query("limit"), 50, 200);
    const offset = pageNumber(c.req.query("offset"), 0, Number.MAX_SAFE_INTEGER);
    return c.json({
      runs: await usage(project, session, limit, offset),
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
  async function run(
    project: string,
    key: Capability,
    body: Record<string, unknown>,
    session: string | undefined,
    signal: AbortSignal,
  ) {
    const { item, options } = capabilityInput(key, body);
    const config = await deps.projects.loadConfig(project);
    const { bindings, candidates, dictationFormat } = capabilitySettings(config);
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
    if (key === "stt" && dictationFormat === "audio/wav") requireDeepSeekAudio(item);
    const bg = body.async === true;
    const result = await deps.runs.run(
      {
        projectId: project,
        sessionId: session,
        capability: key,
        model,
        config: await deps.projects.loadCapabilityModel(project, model),
        item,
        ...(key === "i2t"
          ? { instruction: body.text === undefined ? "Describe this image." : inputText(body.text) }
          : {}),
        options,
      },
      signal,
      bg,
    );
    if (!bg && result.status === "cancelled")
      throw new HttpError(409, "capability_cancelled", "The request was cancelled.");
    if (!bg && result.status === "failed")
      throw new HttpError(502, "capability_failed", result.error!);
    return result;
  }
  app.post("/:capability/run", async (c) => {
    const key = modelOperation(pathParam(c, "capability"));
    if (!key) throw badRequest("Unknown capability.");
    const project = requireValidId(c, "projectId");
    if (!(await deps.capabilities.list(project)).some((c) => c.key === key)) throw unavailable(key);
    const body = await readJson(c);
    const session = sessionScope(deps, project, body.sessionId);
    const result = await run(project, key, body, session, c.req.raw.signal);
    return c.json(result, body.async === true ? 202 : 200);
  });

  // This project-scoped grammar executes only the declared MMSP operations. Unlike the
  // generic administrator plugin CLI, it never calls package code or captures process output.
  app.post("/cli", async (c) => {
    const project = requireValidId(c, "projectId");
    const body = await readJson(c);
    const { args } = body;
    if (!Array.isArray(args) || args.length > 96 || !args.every((a) => typeof a === "string"))
      throw badRequest("Expected a command argument list.");
    const available = await deps.capabilities.list(project);
    const parsed = await parseModelTool(args, available, body.language === "zh" ? "zh" : "en");
    const reply = (r: CapabilityCliReply) => c.json(r);
    if (parsed.kind === "message") return reply(parsed);
    const session = sessionScope(deps, project, parsed.options.sessionId ?? body.sessionId);
    const json = !!parsed.options.json;
    const save = !!parsed.options.out;
    if (parsed.kind === "operation") {
      if (parsed.key === "stt" && body.audio === undefined)
        return reply({ kind: "audio", mimeType: parsed.options.mimeType });
      if (parsed.key === "i2t" && body.image === undefined)
        return reply({ kind: "image", mimeType: parsed.options.mimeType });
      const payload = requestFromCommand(parsed);
      const result = await run(
        project,
        parsed.key,
        { ...payload, audio: body.audio, image: body.image },
        session,
        c.req.raw.signal,
      );
      return reply({ kind: "run", result, detached: !!parsed.options.detach, json, save });
    }
    switch (parsed.key) {
      case "list":
        return reply({
          kind: "data",
          data: canonicalToolSettings(
            projectCapabilities(await deps.projects.loadConfig(project), available),
          ),
          json,
        });
      case "usage":
        return reply({ kind: "data", data: { runs: await usage(project, session, 50, 0) }, json });
      case "artifacts":
        return reply({
          kind: "data",
          data: { artifacts: deps.runs.artifacts(project, session, 50, 0) },
          json,
        });
      case "status":
      case "cancel": {
        const id = parsed.id!;
        let result = deps.runs.get(project, id);
        if (session && result.sessionId !== session)
          throw new HttpError(404, "run_not_found", "Run not found in this Session.");
        if (parsed.key === "cancel") result = deps.runs.cancel(project, id);
        return reply({ kind: "status", result, save, json });
      }
    }
  });
  return app;
}
