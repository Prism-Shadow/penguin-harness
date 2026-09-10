/**
 * Agent porting routes — the portable definition and its integration bundle, apart from the
 * Agent State snapshot routes (agent-transfer.ts), which back up and restore an existing Agent:
 *   GET  /api/projects/:p/agents/:agentId/bundle   (any member; downloads <agentId>-export.zip)
 *   POST /api/projects/:p/agents/import            (any member; creates an Agent from a bundle or a bare penguin-agent.json)
 */
import { Hono } from "hono";
import type { AgentBundleImportResponse, AgentBundleKind, AgentSummary } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { exportAgentBundle, importAgentBundle } from "../../services/agent-porting.js";
import type { PortingDeps } from "../../services/agent-porting.js";
import { optionalString, readJson, requireValidId } from "../validate.js";
import { readArchiveBase64 } from "./agent-transfer.js";
import { ACTIVITY_DAYS } from "./agents.js";

export function agentPortingRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const porting: PortingDeps = {
    root: deps.config.root,
    agentConfig: deps.agentConfigService,
    agents: deps.agentService,
  };

  app.get("/:agentId/bundle", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    // ?kind= picks what is packed around the portable core; an absent or unknown value keeps
    // the integration bundle, which is what every existing caller (the CLI included) expects.
    const kindParam = c.req.query("kind");
    if (kindParam !== undefined && kindParam !== "api" && kindParam !== "docker") {
      throw new HttpError(400, "bad_request", 'kind must be "api" or "docker".');
    }
    const kind: AgentBundleKind = kindParam === "docker" ? "docker" : "api";
    const { fileName, bytes } = await exportAgentBundle(porting, projectId, agentId, kind);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/zip",
        // The agent id is id-validated ([A-Za-z0-9_-]+), so the filename needs no encoding.
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.post("/import", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    const archive = readArchiveBase64(body);
    const agentId = optionalString(body, "agentId", { minLen: 1, maxLen: 64, label: "agentId" });
    const outcome = await importAgentBundle(porting, projectId, archive, agentId);
    const agent: AgentSummary = {
      ...outcome.item,
      activeSessionCount: 0,
      sessionCount: 0,
      sessionActivity: Array.from({ length: ACTIVITY_DAYS }, () => 0),
    };
    return c.json(
      {
        agent,
        installed: outcome.installed,
        skipped: outcome.skipped,
        vaultKeys: outcome.vaultKeys,
      } satisfies AgentBundleImportResponse,
      201,
    );
  });

  return app;
}
