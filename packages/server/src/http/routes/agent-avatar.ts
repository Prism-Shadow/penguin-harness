/**
 * An Agent's own avatar (services/agent-avatar.ts):
 *   GET /api/projects/:p/agents/:a/avatar   the picture; cached for good, since the URL a list
 *                                           hands out carries its revision (`?rev=<avatarRev>`)
 *   PUT /api/projects/:p/agents/:a/avatar   { avatar: dataUrl | null } → { avatarRev? }
 * Any member, like the Agent's other settings. The shape and the errors are the employee
 * avatar's (routes/organizations.ts): a 404 when there is no picture, a 400 naming what is wrong
 * with one that cannot be stored.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AgentAvatarResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AgentConfig } from "../../mechanisms/agents.js";
import type { Access } from "../../mechanisms/projects.js";
import { parseAvatarDataUrl } from "../../services/avatar-file.js";
import type { AvatarImage } from "../../services/avatar-file.js";
import { agentAvatarRev, readAgentAvatar, writeAgentAvatar } from "../../services/agent-avatar.js";
import { HttpError } from "../errors.js";
import { badRequest, readJson, requireValidId } from "../validate.js";

/** What this route group reaches — bound by its module (services/agent-routes.ts). */
export interface AgentAvatarRouteDeps {
  /** The data root the Agent State lives under. */
  root: string;
  agentConfigService: Pick<AgentConfig, "requireExists">;
  access: Access;
}

export function agentAvatarRoutes(deps: AgentAvatarRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** The Agent the path names, once the caller may reach it and it exists. */
  const agentOf = async (c: Context<AppEnv>) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return { projectId, agentId };
  };

  app.get("/", async (c) => {
    const { projectId, agentId } = await agentOf(c);
    const avatar = await readAgentAvatar(deps.root, projectId, agentId);
    if (avatar === null) throw new HttpError(404, "not_found", "This agent has no avatar.");
    return c.body(new Uint8Array(avatar.bytes), 200, {
      "content-type": avatar.mime,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
  });

  app.put("/", async (c) => {
    const { projectId, agentId } = await agentOf(c);
    const body = await readJson(c);
    if (body.avatar !== null && typeof body.avatar !== "string") {
      throw badRequest("avatar must be a data URL, or null to remove it.");
    }
    let image: AvatarImage | null = null;
    if (body.avatar !== null) {
      const parsed = parseAvatarDataUrl(body.avatar);
      if (!parsed.ok) throw badRequest(parsed.error);
      image = parsed;
    }
    await writeAgentAvatar(deps.root, projectId, agentId, image);
    const avatarRev = await agentAvatarRev(deps.root, projectId, agentId);
    return c.json((avatarRev !== undefined ? { avatarRev } : {}) satisfies AgentAvatarResponse);
  });

  return app;
}
