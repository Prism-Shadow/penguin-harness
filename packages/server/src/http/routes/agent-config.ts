/**
 * Agent config routes (reads/writes system_config.yaml and AGENTS.md):
 * GET|PUT /api/projects/:p/agents/:a/config, plus POST …/config/reset to adopt the
 * current default config (keeps only name/description/version — the config-side
 * analogue of a skill update) and POST …/config/mcp-test to probe one MCP Server
 * entry's reachability. Members can read and write (unrestricted).
 */
import { Hono } from "hono";
import { McpToolProvider, resolveMCPServer } from "@prismshadow/penguin-core";
import type { MCPServerConfig } from "@prismshadow/penguin-core";
import type {
  AgentConfigResponse,
  AgentConfigUpdateRequest,
  McpServerTestResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, optionalString, readJson, requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";

export function agentConfigRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Id validation happens before any path construction (FD-4: prevents agentId path traversal for cross-Project privilege escalation).
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const view = await deps.agentConfigService.getConfig(projectId, agentId);
    return c.json({
      ...view,
      activeSessionCount: deps.manager.activeCountForAgent(projectId, agentId),
    } satisfies AgentConfigResponse);
  });

  app.put("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    const req: AgentConfigUpdateRequest = {};
    const agentsMd = optionalString(body, "agentsMd", { label: "agentsMd" });
    if (agentsMd !== undefined) req.agentsMd = agentsMd;
    if (body.config !== undefined) {
      if (body.config === null || typeof body.config !== "object" || Array.isArray(body.config)) {
        throw badRequest("config must be an object.");
      }
      req.config = body.config as AgentConfigUpdateRequest["config"];
    }
    // Fine-grained validation (numeric ranges / enums) is done inside agent-config-service.
    await deps.agentConfigService.updateConfig(projectId, agentId, req);
    const view = await deps.agentConfigService.getConfig(projectId, agentId);
    return c.json({
      ...view,
      activeSessionCount: deps.manager.activeCountForAgent(projectId, agentId),
    } satisfies AgentConfigResponse);
  });

  // Probe one MCP Server entry: connect + discover tools with the entry's own
  // connectTimeoutMs, then close. Runs server-side on purpose — stdio servers spawn on
  // this host, exactly where Sessions run them, and browser-origin HTTP probes would
  // stumble over CORS. A malformed entry is a 400 (same resolver as PUT validation); an
  // unreachable server is a normal `{ ok: false }` result carrying the collected warning
  // (connect error, timeout, stderr tail). Nothing is written to the Agent State.
  app.post("/mcp-test", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    if (typeof body.name !== "string" || body.name.length === 0) {
      throw badRequest("name must be a non-empty string.");
    }
    if (body.config === null || typeof body.config !== "object" || Array.isArray(body.config)) {
      throw badRequest("config must be an object.");
    }
    const entry = { name: body.name, config: body.config } as MCPServerConfig;
    try {
      resolveMCPServer(entry);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : String(err));
    }
    const warnings: string[] = [];
    const provider = new McpToolProvider([entry], { warn: (m) => warnings.push(m) });
    try {
      const tools = await provider.listTools();
      if (warnings.length > 0) {
        return c.json({ ok: false, error: warnings.join("; ") } satisfies McpServerTestResponse);
      }
      return c.json({
        ok: true,
        tools: tools.map((t) => t.name),
      } satisfies McpServerTestResponse);
    } finally {
      await provider.close();
    }
  });

  // Overwrite system_config.yaml with the current defaults (see AgentConfigService.resetConfig
  // for the exact semantics); same authorization as PUT, and responds like GET/PUT with the
  // fresh config so the client can refresh in place.
  app.post("/reset", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.resetConfig(projectId, agentId);
    const view = await deps.agentConfigService.getConfig(projectId, agentId);
    return c.json({
      ...view,
      activeSessionCount: deps.manager.activeCountForAgent(projectId, agentId),
    } satisfies AgentConfigResponse);
  });

  return app;
}
