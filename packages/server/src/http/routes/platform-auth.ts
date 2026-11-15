/** Project-owner routes for authorizing a Penguin Go key. */
import { Hono } from "hono";
import type {
  PlatformAuthFlowStatusResponse,
  PlatformAuthStartResponse,
  PlatformModelSyncResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { PlatformAuth } from "../../services/platform-auth-service.js";
import { HttpError } from "../errors.js";
import { requireValidId } from "../validate.js";
import { modelConfigChanged } from "./models.js";
import type { ModelsRouteDeps } from "./models.js";

export interface PlatformAuthRouteDeps extends ModelsRouteDeps {
  platformAuth: PlatformAuth;
}

const FLOW_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function flowId(value: string): string {
  if (!FLOW_ID_RE.test(value)) {
    throw new HttpError(
      404,
      "platform_auth_flow_not_found",
      "This login has expired or does not exist.",
    );
  }
  return value;
}

function owner(deps: PlatformAuthRouteDeps, userId: string, projectId: string): void {
  deps.access.requireProjectOwner(userId, projectId);
}

function publishIfChanged(deps: PlatformAuthRouteDeps, projectId: string, changed: boolean): void {
  if (changed) modelConfigChanged(deps, projectId);
}

export function platformAuthRoutes(deps: PlatformAuthRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/start", async (c) => {
    const projectId = requireValidId(c, "projectId");
    owner(deps, c.var.user.userId, projectId);
    return c.json(
      (await deps.platformAuth.start({
        projectId,
        userId: c.var.user.userId,
      })) satisfies PlatformAuthStartResponse,
      201,
    );
  });

  app.post("/sync", async (c) => {
    const projectId = requireValidId(c, "projectId");
    owner(deps, c.var.user.userId, projectId);
    const synced = await deps.platformAuth.sync(projectId);
    publishIfChanged(deps, projectId, synced.added > 0 || synced.updated > 0);
    return c.json({
      ...(await deps.projectConfigService.getModels(projectId)),
      added: synced.added,
      updated: synced.updated,
    } satisfies PlatformModelSyncResponse);
  });

  app.get("/:flowId/status", async (c) => {
    const projectId = requireValidId(c, "projectId");
    owner(deps, c.var.user.userId, projectId);
    const result = await deps.platformAuth.status({
      projectId,
      userId: c.var.user.userId,
      flowId: flowId(c.req.param("flowId") ?? ""),
    });
    publishIfChanged(deps, projectId, result.changed === true);
    const { changed: _changed, ...response } = result;
    return c.json(response satisfies PlatformAuthFlowStatusResponse);
  });

  app.post("/:flowId/retry", async (c) => {
    const projectId = requireValidId(c, "projectId");
    owner(deps, c.var.user.userId, projectId);
    const result = await deps.platformAuth.retryApply({
      projectId,
      userId: c.var.user.userId,
      flowId: flowId(c.req.param("flowId") ?? ""),
    });
    publishIfChanged(deps, projectId, result.changed === true);
    const { changed: _changed, ...response } = result;
    return c.json(response satisfies PlatformAuthFlowStatusResponse);
  });

  app.post("/:flowId/cancel", (c) => {
    const projectId = requireValidId(c, "projectId");
    owner(deps, c.var.user.userId, projectId);
    deps.platformAuth.cancel({
      projectId,
      userId: c.var.user.userId,
      flowId: flowId(c.req.param("flowId") ?? ""),
    });
    return c.json({ ok: true });
  });

  return app;
}
