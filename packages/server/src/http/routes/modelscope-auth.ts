/** Project-owner routes for authorizing a ModelScope key through the harness's bridge. */
import { Hono } from "hono";
import type {
  ModelScopeAuthFlowStatusResponse,
  ModelScopeAuthStartResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { ModelScopeAuth } from "../../services/modelscope-auth-service.js";
import { HttpError } from "../errors.js";
import { requireValidId } from "../validate.js";
import { modelConfigChanged } from "./models.js";
import type { ModelsRouteDeps } from "./models.js";

export interface ModelScopeAuthRouteDeps extends ModelsRouteDeps {
  modelScopeAuth: ModelScopeAuth;
}

const FLOW_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function flowId(value: string): string {
  if (!FLOW_ID_RE.test(value)) {
    throw new HttpError(
      404,
      "modelscope_auth_flow_not_found",
      "This login has expired or does not exist.",
    );
  }
  return value;
}

function owner(deps: ModelScopeAuthRouteDeps, userId: string, projectId: string): void {
  deps.access.requireProjectOwner(userId, projectId);
}

function publishIfChanged(
  deps: ModelScopeAuthRouteDeps,
  projectId: string,
  changed: boolean,
): void {
  if (changed) modelConfigChanged(deps, projectId);
}

export function modelScopeAuthRoutes(deps: ModelScopeAuthRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/start", async (c) => {
    const projectId = requireValidId(c, "projectId");
    owner(deps, c.var.user.userId, projectId);
    return c.json(
      (await deps.modelScopeAuth.start({
        projectId,
        userId: c.var.user.userId,
      })) satisfies ModelScopeAuthStartResponse,
      201,
    );
  });

  app.get("/:flowId/status", async (c) => {
    const projectId = requireValidId(c, "projectId");
    owner(deps, c.var.user.userId, projectId);
    const result = await deps.modelScopeAuth.status({
      projectId,
      userId: c.var.user.userId,
      flowId: flowId(c.req.param("flowId") ?? ""),
    });
    publishIfChanged(deps, projectId, result.changed === true);
    const { changed: _changed, ...response } = result;
    return c.json(response satisfies ModelScopeAuthFlowStatusResponse);
  });

  app.post("/:flowId/retry", async (c) => {
    const projectId = requireValidId(c, "projectId");
    owner(deps, c.var.user.userId, projectId);
    const result = await deps.modelScopeAuth.retryApply({
      projectId,
      userId: c.var.user.userId,
      flowId: flowId(c.req.param("flowId") ?? ""),
    });
    publishIfChanged(deps, projectId, result.changed === true);
    const { changed: _changed, ...response } = result;
    return c.json(response satisfies ModelScopeAuthFlowStatusResponse);
  });

  app.post("/:flowId/cancel", (c) => {
    const projectId = requireValidId(c, "projectId");
    owner(deps, c.var.user.userId, projectId);
    deps.modelScopeAuth.cancel({
      projectId,
      userId: c.var.user.userId,
      flowId: flowId(c.req.param("flowId") ?? ""),
    });
    return c.json({ ok: true });
  });

  return app;
}
