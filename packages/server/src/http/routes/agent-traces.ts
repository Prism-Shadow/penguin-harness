/**
 * Agent-level Trace browsing routes:
 *   - GET /api/projects/:p/agents/:a/traces — drills down Agent -> date -> Session -> index (reverse order);
 *   - GET /api/projects/:p/agents/:a/traces/:sessionId/:index (including /analysis, /download) —
 *     read-only Trace detail endpoints (FD-3): locate the Trace file directly by
 *     (projectId, agentId, sessionId), without depending on the sessions table for
 *     tracking — any entry visible in the directory tree (subagent child Sessions,
 *     CLI-created Sessions) can be opened and read; access is enforced by requireProjectAccess.
 *   - POST /api/projects/:p/agents/:a/traces/import — uploads a Trace JSONL file (owner
 *     only, mirroring the Agent snapshot import); the file names itself via its
 *     session_meta and is stored at the session's next free index (never overwriting).
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { TraceImportResponse } from "../../api/types.js";
import {
  badRequest,
  paginationQuery,
  positiveIntParam,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";
import type { AppDeps } from "../../app.js";

/** Import file size cap: aligned with the snapshot import (stays within the 20MB body limit after base64). */
const MAX_TRACE_BYTES = 14 * 1024 * 1024;

export function agentTracesRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Id validation happens before any path construction (FD-4: prevents agentId path traversal for cross-Project privilege escalation).
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.traceService.agentTraces(projectId, agentId));
  });

  app.get("/:sessionId/:index", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const sessionId = requireValidId(c, "sessionId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const index = positiveIntParam(c, "index");
    const { offset, limit } = paginationQuery(c);
    return c.json(
      await deps.traceService.readEvents(projectId, agentId, sessionId, index, offset, limit),
    );
  });

  app.get("/:sessionId/:index/analysis", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const sessionId = requireValidId(c, "sessionId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const index = positiveIntParam(c, "index");
    return c.json(await deps.traceService.analyze(projectId, agentId, sessionId, index));
  });

  // Raw-file download (any member, like the snapshot export): the file is served verbatim
  // as an attachment, so what's downloaded can be re-imported byte-compatibly.
  app.get("/:sessionId/:index/download", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const sessionId = requireValidId(c, "sessionId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const index = positiveIntParam(c, "index");
    const bytes = await deps.traceService.readFileRaw(projectId, agentId, sessionId, index);
    const fileName = `${sessionId}_${String(index).padStart(3, "0")}.jsonl`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  // Trace file upload (owner only, mirroring the Agent snapshot import): the route checks the
  // transport shape (base64, size); the content itself — JSONL, leading session_meta, a
  // filename-safe session_id — is validated by the service right where the path is built.
  app.post("/import", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const body = await readJson(c);
    const dataBase64 = requireString(body, "dataBase64", { minLen: 1, maxLen: 20 * 1024 * 1024 });
    const bytes = Buffer.from(dataBase64, "base64");
    if (bytes.byteLength === 0) throw badRequest("Import file is empty.");
    if (bytes.byteLength > MAX_TRACE_BYTES) {
      throw badRequest("Import file exceeds the 14MB limit.");
    }
    const res: TraceImportResponse = await deps.traceService.importTraceFile(
      projectId,
      agentId,
      bytes.toString("utf8"),
    );
    return c.json(res);
  });

  return app;
}
