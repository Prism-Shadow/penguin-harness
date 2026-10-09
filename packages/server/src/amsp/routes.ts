/**
 * The Agent API's public routes, `/api/amsp/v1` — mounted in front of the cookie gate, since an
 * external program has no cookie: the key, when there is one, is all it presents.
 *
 *   GET  /agents/:projectId/:agentId                  the Agent's name and description
 *   POST /agents/:projectId/:agentId/runs             one run, streamed (run-stream.ts)
 *   GET  /sessions/:sessionId                         an API Session's state and model
 *   POST /sessions/:sessionId/abort                   202 interrupted / 204 nothing running
 *   POST /sessions/:sessionId/approvals/:toolCallId   answer a pending approval
 *   *    anything else                                404 not_found (JSON, never the SPA)
 *
 * CORS (cors.ts): a preflight is always answered; `Access-Control-Allow-Origin: *` goes only on
 * requests that carry `Authorization`, the global 413/415 refusals included. The `/api/*` CSRF
 * guard (JSON-only writes) stays in force; nothing here reads a cookie.
 *
 * One route of the family sits behind the cookie gate instead: the API tab's Try it,
 * `POST /api/projects/:projectId/agents/:agentId/api/try` (try-route.ts), the runs route's
 * handler for the Project owner's sign-in in place of a key.
 */
import { Hono } from "hono";
import type { AgentResponse, SessionResponse } from "@prismshadow/amsp";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { readJson, requireEnum } from "../http/validate.js";
import type { AgentConfig } from "../mechanisms/agents.js";
import type { Settings } from "../mechanisms/settings.js";
import { AMSP_PREFIX, amspCors } from "./cors.js";
import { amspGate } from "./gate.js";
import type { AmspEnv, AmspGateDeps } from "./gate.js";
import { runStream } from "./run-stream.js";
import type { RunStreamDeps } from "./run-stream.js";

export interface AmspRouteDeps
  extends
    Omit<AmspGateDeps, "settings" | "agentConfig">,
    Omit<RunStreamDeps, "settings" | "manager"> {
  settings: Pick<Settings, "getAgentApiEnabled" | "getAttachmentLimitsMb">;
  agentConfig: Pick<AgentConfig, "exists" | "readCardMeta">;
  manager: RunStreamDeps["manager"] & {
    decideApproval(sessionId: string, toolCallId: string, decision: "allow" | "deny"): boolean;
  };
}

export function amspRoutes(deps: AmspRouteDeps): Hono<AppEnv> {
  const app = new Hono<AmspEnv>();

  app.use("*", amspCors);

  app.use("*", amspGate(AMSP_PREFIX, deps));

  app.get("/agents/:projectId/:agentId", async (c) => {
    const { projectId, agentId } = c.var.amsp;
    const meta = await deps.agentConfig.readCardMeta(projectId, agentId);
    const body: AgentResponse = {
      agent: {
        id: `${projectId}/${agentId}`,
        ...(meta.name !== undefined ? { name: meta.name } : {}),
        ...(meta.description !== undefined ? { description: meta.description } : {}),
      },
    };
    return c.json(body);
  });

  app.post("/agents/:projectId/:agentId/runs", (c) => runStream(c, deps));

  app.get("/sessions/:sessionId", (c) => {
    const { projectId, agentId, session } = c.var.amsp;
    const row = session!;
    const body: SessionResponse = {
      session: {
        id: row.sessionId,
        agent: `${projectId}/${agentId}`,
        status: deps.manager.statusOf(row.sessionId),
        provider: row.provider,
        model_id: row.modelId,
        created_at: row.createdAt,
        last_active_at: row.lastActiveAt,
      },
    };
    return c.json(body);
  });

  app.post("/sessions/:sessionId/abort", (c) => {
    const sessionId = c.var.amsp.session!.sessionId;
    // Pending approvals are denied first, then the run is signalled; the run's own stream stays
    // open until it ends with run.done "aborted".
    return c.body(null, deps.manager.abortTask(sessionId) ? 202 : 204);
  });

  app.post("/sessions/:sessionId/approvals/:toolCallId", async (c) => {
    const sessionId = c.var.amsp.session!.sessionId;
    const toolCallId = c.req.param("toolCallId");
    const body = await readJson(c);
    const decision = requireEnum(body, "decision", ["allow", "deny"] as const);
    // The same registry the Web App's approval card answers: whichever answer comes first wins.
    if (!deps.manager.decideApproval(sessionId, toolCallId, decision)) {
      throw new HttpError(
        404,
        "approval_not_found",
        "No pending approval for this tool call (already decided, or unknown).",
      );
    }
    return c.body(null, 204);
  });

  // The group owns its prefix: an unknown path is a JSON 404, never the SPA or the cookie gate's 401.
  app.all("/*", () => {
    throw new HttpError(404, "not_found", "Not found.");
  });

  return app as unknown as Hono<AppEnv>;
}
