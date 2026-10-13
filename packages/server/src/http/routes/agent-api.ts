/**
 * Agent API management (`/api/projects/:projectId/agents/:agentId/api`): the API tab and
 * `penguin agent api` read and change one Agent's exposure here.
 *
 *   GET    /               member   the switch, keyless access, the approval mode, the keys
 *   PUT    /               owner    change the switch, keyless access and/or the approval mode
 *   POST   /keys           owner    create a key: the secret is in this response and nowhere else
 *   DELETE /keys/:keyId    owner    delete a key: its next request is refused
 *
 * Owner means the Project owner, the rule Agent deletion uses: exposing an Agent to programs
 * outside the Web App is a Project-level decision, and so is the approval mode those programs'
 * conversations start with. The settings live in this server's web.db (see AgentApi), never in
 * the Agent State the Agent itself can rewrite. And the writes take the owner's sign-in, never
 * the local API token every tool subprocess holds (403 `human_required`, see requireHuman): an
 * Agent must not switch on its own exposure from its shell. The reads stay open to the token,
 * for `penguin agent api status` and `keys ls`.
 */
import { Hono } from "hono";
import { THINKING_LEVEL_NAMES, resolveModelRef } from "@prismshadow/penguin-core";
import { assertWorkspaceAllowed } from "../../services/workspace-guard.js";
import type { Context } from "hono";
import type {
  AgentApiKeyCreateResponse,
  AgentApiKeyInfo,
  AgentApiResponse,
  ModelRefDto,
} from "../../api/types.js";
import { requireHuman } from "../../auth/middleware.js";
import type { AppEnv } from "../../auth/middleware.js";
import { mintAgentApiKey } from "../../amsp/keys.js";
import { HttpError } from "../errors.js";
import {
  badRequest,
  optionalString,
  optionalBoolean,
  optionalNumber,
  optionalEnum,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";
import { APPROVAL_MODES } from "./sessions.js";
import { DEFAULT_API_CONCURRENT_RUNS } from "../../mechanisms/agent-api.js";
import type { AgentApi, AgentApiKeyRow } from "../../mechanisms/agent-api.js";
import type { AgentConfig } from "../../mechanisms/agents.js";
import type { ProjectConfigStore, Access } from "../../mechanisms/projects.js";
import type { Settings } from "../../mechanisms/settings.js";

/** What this route group reaches — bound by its module (services/agent-routes.ts). */
export interface AgentApiRouteDeps {
  agentApi: AgentApi;
  projectConfig: Pick<ProjectConfigStore, "loadConfig">;
  agentConfigService: Pick<AgentConfig, "requireExists">;
  access: Pick<Access, "requireProjectAccess" | "requireProjectOwner">;
  settings: Pick<Settings, "getAgentApiEnabled">;
  now: () => Date;
}

/** A key as the list shows it: never the secret, never its hash. */
function keyInfo(row: AgentApiKeyRow): AgentApiKeyInfo {
  return {
    keyId: row.keyId,
    name: row.name,
    prefix: row.prefix,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export function agentApiRoutes(deps: AgentApiRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** The Agent's settings as the tab reads them; a never-configured Agent reads as off, keyed, allow-all. */
  const settings = (projectId: string, agentId: string): AgentApiResponse => {
    const row = deps.agentApi.get(projectId, agentId);
    return {
      api: {
        enabled: row?.enabled ?? false,
        open: row?.open ?? false,
        approvalMode: row?.approvalMode ?? "allow-all",
        model: row?.model ?? null,
        thinkingLevel: row?.thinkingLevel ?? null,
        workspace: row?.workspace ?? null,
        maxConcurrentRuns: row?.maxConcurrentRuns ?? DEFAULT_API_CONCURRENT_RUNS,
        keys: deps.agentApi.listKeys(projectId, agentId).map(keyInfo),
      },
      // The tab says when the admin has the whole API off: only an admin can read that setting.
      serverEnabled: deps.settings.getAgentApiEnabled(),
    };
  };

  /** The path's Agent, once the caller may reach it (`owner` for the writes) and it exists. */
  const agentOf = async (
    c: Context<AppEnv>,
    owner: boolean,
  ): Promise<{ projectId: string; agentId: string }> => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    if (owner) deps.access.requireProjectOwner(c.var.user.userId, projectId);
    else deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return { projectId, agentId };
  };

  app.get("/", async (c) => {
    const { projectId, agentId } = await agentOf(c, false);
    return c.json(settings(projectId, agentId));
  });

  app.put("/", async (c) => {
    requireHuman(c);
    const { projectId, agentId } = await agentOf(c, true);
    const body = await readJson(c);
    // Every field is checked before any is written.
    const enabled = optionalBoolean(body, "enabled");
    const open = optionalBoolean(body, "open");
    const approvalMode = optionalEnum(body, "approvalMode", APPROVAL_MODES);
    const maxConcurrentRuns = optionalNumber(body, "maxConcurrentRuns", { integer: true });
    if (
      maxConcurrentRuns !== undefined &&
      (!Number.isSafeInteger(maxConcurrentRuns) || maxConcurrentRuns < 1)
    ) {
      throw badRequest("maxConcurrentRuns must be a positive safe integer.");
    }
    let model: ModelRefDto | null | undefined;
    if (body.model === null) model = null;
    else if (body.model !== undefined) {
      if (typeof body.model !== "object" || Array.isArray(body.model)) {
        throw badRequest("model must be a model reference or null.");
      }
      const ref = body.model as Record<string, unknown>;
      model = {
        provider: requireString(ref, "provider", { minLen: 1, maxLen: 64 }),
        modelId: requireString(ref, "modelId", { minLen: 1, maxLen: 200 }),
      };
      const config = await deps.projectConfig.loadConfig(projectId);
      try {
        resolveModelRef(config, model.modelId, model.provider);
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : String(e));
      }
    }
    const thinkingLevel =
      body.thinkingLevel === null
        ? null
        : optionalEnum(body, "thinkingLevel", THINKING_LEVEL_NAMES);
    let workspace =
      body.workspace === null
        ? null
        : optionalString(body, "workspace", { minLen: 1, maxLen: 4096 });
    if (workspace != null) workspace = await assertWorkspaceAllowed({ workspace });
    deps.agentApi.set(
      projectId,
      agentId,
      {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(open !== undefined ? { open } : {}),
        ...(approvalMode !== undefined ? { approvalMode } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        ...(workspace !== undefined ? { workspace } : {}),
        ...(maxConcurrentRuns !== undefined ? { maxConcurrentRuns } : {}),
      },
      deps.now().toISOString(),
    );
    return c.json(settings(projectId, agentId));
  });

  app.post("/keys", async (c) => {
    requireHuman(c);
    const { projectId, agentId } = await agentOf(c, true);
    const body = await readJson(c);
    const name = requireString(body, "name", { maxLen: 64, label: "name" }).trim();
    if (name === "") throw new HttpError(400, "bad_request", "name must be 1-64 characters.");
    const minted = mintAgentApiKey();
    const row: AgentApiKeyRow = {
      keyId: minted.keyId,
      projectId,
      agentId,
      prefix: minted.prefix,
      name,
      createdBy: c.var.user.userId,
      createdAt: deps.now().toISOString(),
      lastUsedAt: null,
    };
    deps.agentApi.insertKey({ ...row, tokenHash: minted.tokenHash });
    return c.json(
      { key: keyInfo(row), secret: minted.secret } satisfies AgentApiKeyCreateResponse,
      201,
    );
  });

  app.delete("/keys/:keyId", async (c) => {
    requireHuman(c);
    const { projectId, agentId } = await agentOf(c, true);
    if (!deps.agentApi.deleteKey(projectId, agentId, c.req.param("keyId"))) {
      throw new HttpError(404, "key_not_found", "This Agent has no key with that id.");
    }
    return c.body(null, 204);
  });

  return app;
}
