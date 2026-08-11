/**
 * Agent config routes (reads/writes system_config.yaml and AGENTS.md):
 * GET|PUT /api/projects/:p/agents/:a/config, plus POST …/config/reset to adopt the
 * current default config (keeps only name/description/version — the config-side
 * analogue of a skill update) and POST …/config/mcp-test to probe one MCP Server
 * entry's reachability. Members can read and write (unrestricted).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** Ceiling on a single mcp-test probe's connect budget (an entry may configure minutes). */
const MCP_TEST_TIMEOUT_CAP_MS = 30_000;

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
    let resolved;
    try {
      resolved = resolveMCPServer(entry);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : String(err));
    }
    // A probe must not hold a request open arbitrarily long (the bulk test walks every
    // server sequentially): the entry's own connect budget applies, capped for testing.
    if (resolved.connectTimeoutMs > MCP_TEST_TIMEOUT_CAP_MS) {
      entry.config = { ...entry.config, connectTimeoutMs: MCP_TEST_TIMEOUT_CAP_MS };
    }
    const warnings: string[] = [];
    // A fresh empty directory stands in for the Session Workspace (a new session's
    // temporary workspace is exactly that), so a stdio server that resolves relative
    // paths behaves like it will at runtime — not like the server process's own cwd.
    const workspaceDir = await mkdtemp(join(tmpdir(), "penguin-mcp-test-"));
    const provider = new McpToolProvider([entry], {
      workspaceDir,
      warn: (m) => warnings.push(m),
    });
    const startedAt = Date.now();
    try {
      const tools = await provider.listTools();
      const latencyMs = Date.now() - startedAt;
      // Verdict comes from the connect outcome itself, not from the warning count:
      // benign warnings (a tool listed twice / an LLM-unusable tool name) must not
      // report a healthy server as failed.
      const outcome = provider.connectResults()[0];
      if (outcome === undefined || outcome.status !== "completed") {
        return c.json({
          ok: false,
          error: outcome?.error ?? (warnings.length > 0 ? warnings.join("; ") : "connect failed"),
          latencyMs,
        } satisfies McpServerTestResponse);
      }
      return c.json({
        ok: true,
        tools: tools.map((t) => t.name),
        latencyMs,
      } satisfies McpServerTestResponse);
    } finally {
      await provider.close();
      void rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
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
