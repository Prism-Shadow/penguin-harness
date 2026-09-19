/**
 * Coding-agent routes (Agent Client Protocol agents driven as server subprocesses):
 *   GET    /api/coding-agents/agents                                   (any user)
 *   POST   /api/coding-agents/agents                                   (admin: save a custom definition)
 *   DELETE /api/coding-agents/agents/:agentId                          (admin)
 *   GET    /api/coding-agents/sessions                                 (any user)
 *   POST   /api/coding-agents/sessions                                 (any user: { agentId, workspaceDir })
 *   GET    /api/coding-agents/sessions/:sessionId                      (detail + event log)
 *   GET    /api/coding-agents/sessions/:sessionId/stream               (SSE)
 *   POST   /api/coding-agents/sessions/:sessionId/prompt               ({ text } -> 202; turn streams)
 *   POST   /api/coding-agents/sessions/:sessionId/permissions/:requestId ({ outcome } -> 204)
 *   POST   /api/coding-agents/sessions/:sessionId/cancel               (204)
 *   POST   /api/coding-agents/sessions/:sessionId/mode                 ({ modeId } -> 204)
 *   DELETE /api/coding-agents/sessions/:sessionId                      (204)
 *
 * Reading and running is any authenticated user — the same trust level as creating a
 * Session in an arbitrary workspace. Definitions are server-global, so writing them is
 * admin-only, like the rest of the admin settings.
 */
import { Hono, type Context } from "hono";
import { AcpAgentError } from "@prismshadow/penguin-coding-agents";
import type { AppEnv } from "../../auth/middleware.js";
import type { CodingAgents } from "../../mechanisms/coding-agents.js";
import { sseEndpoint } from "../sse.js";
import { HttpError } from "../errors.js";
import { badRequest, pathParam, readJson, requireString, requireValidId } from "../validate.js";

/** What this route group reaches — bound by its module (see services/agent-routes.ts). */
export interface CodingAgentsRouteDeps {
  codingAgents: CodingAgents;
}

function requireSessionId(c: Context<AppEnv>): string {
  return requireValidId(c, "sessionId");
}

function requireExistingSession(deps: CodingAgentsRouteDeps, sessionId: string): void {
  if (deps.codingAgents.sessionDetail(sessionId) === undefined) {
    throw new HttpError(404, "not_found", "Coding-agent session does not exist.");
  }
}

/** Kernel rejections (unknown agent, bad workspace, ...) are caller errors: 400, with the kernel's own safe message. */
function rethrowKernelError(error: unknown, busyStatus = false): never {
  if (error instanceof AcpAgentError) {
    throw new HttpError(
      busyStatus ? 409 : 400,
      busyStatus ? "session_busy" : "bad_request",
      error.message,
    );
  }
  throw error;
}

export function codingAgentsRoutes(deps: CodingAgentsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/agents", (c) => c.json({ agents: deps.codingAgents.listAgents() }));

  app.post("/agents", async (c) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "forbidden", "Admin access is required.");
    }
    const body = await readJson(c);
    let agent;
    try {
      agent = deps.codingAgents.saveAgent(body);
    } catch (error) {
      rethrowKernelError(error);
    }
    return c.json({ agent }, 201);
  });

  app.delete("/agents/:agentId", async (c) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "forbidden", "Admin access is required.");
    }
    const agentId = pathParam(c, "agentId");
    if (!deps.codingAgents.removeAgent(agentId)) {
      throw new HttpError(404, "not_found", "Agent definition does not exist.");
    }
    return c.body(null, 204);
  });

  app.get("/sessions", (c) => c.json({ sessions: deps.codingAgents.listSessions() }));

  app.post("/sessions", async (c) => {
    const body = await readJson(c);
    const agentId = requireString(body, "agentId", { maxLen: 64, label: "agentId" });
    const workspaceDir = requireString(body, "workspaceDir", {
      maxLen: 1024,
      label: "workspaceDir",
    });
    let session;
    try {
      session = await deps.codingAgents.createSession(agentId, workspaceDir);
    } catch (error) {
      rethrowKernelError(error);
    }
    return c.json({ session }, 201);
  });

  app.get("/sessions/:sessionId", (c) => {
    const sessionId = requireSessionId(c);
    const detail = deps.codingAgents.sessionDetail(sessionId);
    if (detail === undefined) {
      throw new HttpError(404, "not_found", "Coding-agent session does not exist.");
    }
    return c.json(detail);
  });

  app.get("/sessions/:sessionId/stream", (c) => {
    const sessionId = requireSessionId(c);
    const detail = deps.codingAgents.sessionDetail(sessionId);
    const channel = deps.codingAgents.channelFor(sessionId);
    if (detail === undefined || channel === undefined) {
      throw new HttpError(404, "not_found", "Coding-agent session does not exist.");
    }
    // The snapshot rides the `server_event` name (sseEndpoint's initialEvents); the live
    // kernel events follow as `coding_agent` events, bridged in CodingAgentService.
    return sseEndpoint(c, channel, {
      initialEvents: [{ type: "coding_agent_snapshot", sessionId, events: detail.events }],
    });
  });

  app.post("/sessions/:sessionId/prompt", async (c) => {
    const sessionId = requireSessionId(c);
    requireExistingSession(deps, sessionId);
    const body = await readJson(c);
    const text = requireString(body, "text", { maxLen: 512 * 1024, label: "text" });
    try {
      // Fire-and-forget by design: the turn streams over the session channel and the POST
      // answers 202 immediately (the session-tasks pattern); failures land in the log as
      // turn_end failed. A synchronous throw here means the turn never started.
      deps.codingAgents.prompt(sessionId, text);
    } catch (error) {
      rethrowKernelError(error, true);
    }
    return c.body(null, 202);
  });

  app.post("/sessions/:sessionId/permissions/:requestId", async (c) => {
    requireSessionId(c);
    const requestId = pathParam(c, "requestId");
    const body = await readJson(c);
    const outcome = (body as { outcome?: unknown }).outcome;
    if (outcome === null || typeof outcome !== "object") {
      throw badRequest(
        'outcome must be { outcome: "selected", optionId } or { outcome: "cancelled" }.',
      );
    }
    const kind = (outcome as { outcome?: unknown }).outcome;
    if (kind !== "selected" && kind !== "cancelled") {
      throw badRequest('outcome.outcome must be "selected" or "cancelled".');
    }
    if (kind === "selected" && typeof (outcome as { optionId?: unknown }).optionId !== "string") {
      throw badRequest("a selected outcome requires optionId.");
    }
    const answered = deps.codingAgents.respondPermission(
      requestId,
      kind === "selected"
        ? { outcome: "selected", optionId: (outcome as { optionId: string }).optionId }
        : { outcome: "cancelled" },
    );
    if (!answered) {
      throw new HttpError(
        404,
        "not_found",
        "Permission request does not exist or was already answered.",
      );
    }
    return c.body(null, 204);
  });

  app.post("/sessions/:sessionId/cancel", async (c) => {
    const sessionId = requireSessionId(c);
    requireExistingSession(deps, sessionId);
    try {
      await deps.codingAgents.cancel(sessionId);
    } catch (error) {
      rethrowKernelError(error);
    }
    return c.body(null, 204);
  });

  app.post("/sessions/:sessionId/mode", async (c) => {
    const sessionId = requireSessionId(c);
    requireExistingSession(deps, sessionId);
    const body = await readJson(c);
    const modeId = requireString(body, "modeId", { maxLen: 200, label: "modeId" });
    try {
      await deps.codingAgents.setMode(sessionId, modeId);
    } catch (error) {
      rethrowKernelError(error);
    }
    return c.body(null, 204);
  });

  app.delete("/sessions/:sessionId", async (c) => {
    const sessionId = requireSessionId(c);
    await deps.codingAgents.disposeSession(sessionId);
    return c.body(null, 204);
  });

  return app;
}
