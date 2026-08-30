/**
 * New-chat defaults routes: GET|PUT /api/projects/:p/chat-defaults (the `[default_chat]`
 * block of .project_config.toml). Any member can read (the draft page prefills from it);
 * only the owner can replace it. PUT is declarative whole-block replace: an omitted key
 * clears it, an empty body removes the block. The default MODEL is not part of this block —
 * it stays the top-level `default_model` maintained via the models routes.
 */
import { Hono } from "hono";
import { DEFAULT_CHAT_THINKING_LEVELS, isValidId } from "@prismshadow/penguin-core";
import type { ChatDefaultsDto } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { HttpError } from "../errors.js";
import { optionalEnum, optionalString, readJson, requireValidId } from "../validate.js";
import { APPROVAL_MODES } from "./sessions.js";
import type { AgentConfig } from "../../mechanisms/agents.js";
import type { Access, ProjectConfigStore } from "../../mechanisms/projects.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface ChatDefaultsRouteDeps {
  agentConfigService: AgentConfig;
  projectConfigService: ProjectConfigStore;
  access: Access;
}

export function chatDefaultsRoutes(deps: ChatDefaultsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Defensive id validation.
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.projectConfigService.getChatDefaults(projectId));
  });

  app.put("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const req: ChatDefaultsDto = {};

    // agentId must reference an existing Agent of this Project (a stale default would make
    // every prefilled draft 404). isValidId first: existence is checked by path
    // (system_config.yaml presence, the same rule the agent routes use), so a junk id must
    // never reach path construction.
    const agentId = optionalString(body, "agentId", { minLen: 1, maxLen: 64, label: "agentId" });
    if (agentId !== undefined) {
      if (!isValidId(agentId) || !(await deps.agentConfigService.exists(projectId, agentId))) {
        throw new HttpError(
          400,
          "unknown_agent",
          `agentId does not reference an Agent of this Project: ${agentId}.`,
        );
      }
      req.agentId = agentId;
    }

    // Not validated as an existing directory on purpose: the default is a prefill, and the
    // directory is (re)checked when a Session is actually created. "" = clear (temporary workspace).
    const workspace = optionalString(body, "workspace", { maxLen: 4096, label: "workspace" });
    if (workspace !== undefined && workspace !== "") req.workspace = workspace;

    const approvalMode = optionalEnum(body, "approvalMode", APPROVAL_MODES);
    if (approvalMode !== undefined) req.approvalMode = approvalMode;

    // Only the selectable tiers — "none" is rejected (never offered as a default).
    const thinkingLevel = optionalEnum(body, "thinkingLevel", DEFAULT_CHAT_THINKING_LEVELS);
    if (thinkingLevel !== undefined) req.thinkingLevel = thinkingLevel;

    return c.json(await deps.projectConfigService.setChatDefaults(projectId, req));
  });

  return app;
}
