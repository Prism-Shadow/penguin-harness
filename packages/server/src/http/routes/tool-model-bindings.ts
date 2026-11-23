/**
 * The tool-model bindings of a Project: GET|PATCH /api/projects/:projectId/models/tool-bindings.
 *
 * GET lists every binding the loaded plugins declare, with the Project's model for it and the
 * configured models it accepts (any member, like the models table). PATCH binds one key, or with
 * `model: null` unbinds it (owner only, like every model-config write), and answers the list.
 */
import { Hono } from "hono";
import type { Access } from "@prismshadow/penguin-library-project";
import type {
  ToolModelBindingUpdate,
  ToolModelBindingsResponse,
} from "@prismshadow/penguin-library-model";
import type { AppEnv } from "../../auth/middleware.js";
import type { ToolModelBindings } from "../../services/tool-model-bindings.js";
import { toolBindingKeyFault } from "../../services/tool-binding-key.js";
import { badRequest, readJson, requireString, requireValidId } from "../validate.js";

export interface ToolModelBindingRouteDeps {
  bindings: ToolModelBindings;
  access: Access;
  /** After a write: tell the Project's users and the machines it uses. */
  changed(projectId: string): void;
}

/** A PATCH body: a binding key and a `{ provider, modelId }` pair or null. */
function parseUpdate(body: Record<string, unknown>): ToolModelBindingUpdate {
  const key = requireString(body, "key", { minLen: 1, maxLen: 64 });
  const fault = toolBindingKeyFault(key);
  if (fault !== null) throw badRequest(fault);
  const model = body.model;
  if (model === null) return { key, model: null };
  if (typeof model !== "object" || model === undefined || Array.isArray(model)) {
    throw badRequest("model must be a { provider, modelId } object or null.");
  }
  const ref = model as Record<string, unknown>;
  return {
    key,
    model: {
      provider: requireString(ref, "provider", { minLen: 1, maxLen: 64, label: "model.provider" }),
      modelId: requireString(ref, "modelId", { minLen: 1, maxLen: 200, label: "model.modelId" }),
    },
  };
}

export function toolModelBindingRoutes(deps: ToolModelBindingRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return c.json({
      bindings: await deps.bindings.list(projectId),
    } satisfies ToolModelBindingsResponse);
  });

  app.patch("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const { key, model } = parseUpdate(await readJson(c));
    const bindings = await deps.bindings.set(projectId, key, model);
    deps.changed(projectId);
    return c.json({ bindings } satisfies ToolModelBindingsResponse);
  });

  return app;
}
