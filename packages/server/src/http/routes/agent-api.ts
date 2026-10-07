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
 * the Agent State the Agent itself can rewrite.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  AgentApiKeyCreateResponse,
  AgentApiKeyInfo,
  AgentApiResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { mintAgentApiKey } from "../../amsp/keys.js";
import { HttpError } from "../errors.js";
import {
  optionalBoolean,
  optionalEnum,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";
import { APPROVAL_MODES } from "./sessions.js";
import type { AgentApi, AgentApiKeyRow } from "../../mechanisms/agent-api.js";
import type { AgentConfig } from "../../mechanisms/agents.js";
import type { Access } from "../../mechanisms/projects.js";

/** What this route group reaches — bound by its module (services/agent-routes.ts). */
export interface AgentApiRouteDeps {
  agentApi: AgentApi;
  agentConfigService: Pick<AgentConfig, "requireExists">;
  access: Pick<Access, "requireProjectAccess" | "requireProjectOwner">;
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
        keys: deps.agentApi.listKeys(projectId, agentId).map(keyInfo),
      },
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
    const { projectId, agentId } = await agentOf(c, true);
    const body = await readJson(c);
    // Every field is checked before any is written.
    const enabled = optionalBoolean(body, "enabled");
    const open = optionalBoolean(body, "open");
    const approvalMode = optionalEnum(body, "approvalMode", APPROVAL_MODES);
    deps.agentApi.set(
      projectId,
      agentId,
      {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(open !== undefined ? { open } : {}),
        ...(approvalMode !== undefined ? { approvalMode } : {}),
      },
      deps.now().toISOString(),
    );
    return c.json(settings(projectId, agentId));
  });

  app.post("/keys", async (c) => {
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
    const { projectId, agentId } = await agentOf(c, true);
    if (!deps.agentApi.deleteKey(projectId, agentId, c.req.param("keyId"))) {
      throw new HttpError(404, "key_not_found", "This Agent has no key with that id.");
    }
    return c.body(null, 204);
  });

  return app;
}
