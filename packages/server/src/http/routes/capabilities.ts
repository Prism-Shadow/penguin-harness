import { Hono } from "hono";
import type { ProjectConfig } from "@prismshadow/penguin-core";
import type { AppEnv } from "../../auth/middleware.js";
import { sessionScope, type CapabilityDependencies } from "../../cli/model-tool-routes.js";
import { inputText } from "../../services/capability-input.js";
import { capabilitySettings, dto } from "../../services/capability-settings.js";
import { HttpError } from "../errors.js";
import { readJson, requireValidId } from "../validate.js";

function chosenPolish(config: ProjectConfig) {
  if (!config.voice_polish_enabled)
    throw new HttpError(409, "voice_polish_disabled", "Transcript editing is disabled.");
  const ref = config.tools?.t2t;
  if (!ref)
    throw new HttpError(409, "model_unavailable", "Choose a chat model to edit transcripts.");
  const settings = capabilitySettings(config);
  if (
    !settings.candidates.t2t.some((r) => r.provider === ref.provider && r.modelId === ref.model_id)
  )
    throw new HttpError(409, "model_unavailable", "The configured model cannot edit text.");
  return dto(ref);
}
export function voicePolishRoutes(deps: CapabilityDependencies) {
  const app = new Hono<AppEnv>();
  app.post("/", async (c) => {
    const project = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, project);
    const body = await readJson(c);
    const session = sessionScope(deps, project, body.sessionId);
    const text = inputText(body.text);
    const config = await deps.projects.loadConfig(project);
    const model = chosenPolish(config);
    if (!(await deps.capabilities.list(project)).some((c) => c.key === "t2t"))
      throw new HttpError(
        409,
        "capability_unavailable",
        "Enable a plugin providing the text tool to edit transcripts.",
      );
    const result = await deps.runs.run(
      {
        projectId: project,
        sessionId: session,
        capability: "voice-polish",
        model,
        config: await deps.projects.loadCapabilityModel(project, model),
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
