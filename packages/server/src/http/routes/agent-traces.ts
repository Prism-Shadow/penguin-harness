/**
 * Agent-level Trace browsing routes:
 *   - GET /api/projects/:p/agents/:a/traces — Agent-level listing. Without `limit`: the
 *     legacy full drill-down (Agent -> date -> Session -> index, reverse order). With
 *     optional `offset`/`limit` (+ optional `category`): pages Session groups
 *     newest-first (within the category when given), stat-ing only the returned page,
 *     and resolves per group a display title (sessions DB title, else derived from the
 *     first user prompt) plus its sidebar category / Workspace and per-category totals.
 *     The **listing** therefore consults the sessions table — read-only (titles,
 *     archived, workspace); visibility still comes from the directory scan alone (a
 *     Session missing from the table is listed all the same — CLI/subagent Sessions
 *     stay visible here regardless of the sidebar's CLI preference, this being the
 *     observability surface — its title simply falling back or staying absent).
 *   - GET /api/projects/:p/agents/:a/traces/:sessionId/:index (including /analysis, /download) —
 *     read-only Trace detail endpoints (FD-3): locate the Trace file directly by
 *     (projectId, agentId, sessionId), without depending on the sessions table for
 *     tracking — any entry visible in the directory tree (subagent child Sessions,
 *     CLI-created Sessions) can be opened and read; access is enforced by requireProjectAccess.
 *   - POST /api/projects/:p/agents/:a/traces/import — uploads a Trace JSONL file (owner
 *     only, mirroring the Agent snapshot import); the file names itself via its
 *     session_meta and always becomes index 001 of a new Session — a session id the
 *     Agent already has is rejected with 409 trace_session_exists.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { SessionCategory, TraceImportResponse } from "../../api/types.js";
import {
  badRequest,
  optionalPagingQuery,
  paginationQuery,
  positiveIntParam,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";
import type { AppDeps } from "../../app.js";

/** Import file size cap: aligned with the snapshot import (stays within the 20MB body limit after base64). */
const MAX_TRACE_BYTES = 14 * 1024 * 1024;

/** Accepted `category` query values of the paginated listing (SessionCategory, spelled out for validation — same as the sessions list route). */
const SESSION_CATEGORIES: readonly SessionCategory[] = [
  "active",
  "subagent",
  "schedule",
  "archived",
];

export function agentTracesRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Id validation happens before any path construction (FD-4: prevents agentId path traversal for cross-Project privilege escalation).
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    // Both params absent -> null -> the legacy full response, byte-for-byte as before.
    const paging = optionalPagingQuery(c);
    // Optional category filter (paging then applies within the category): only meaningful
    // on the paginated session-centric shape — the legacy full drill-down has no category
    // notion, so a filtered-but-unpaged request is a client error, not a silent no-op.
    const rawCategory = c.req.query("category");
    if (
      rawCategory !== undefined &&
      !(SESSION_CATEGORIES as readonly string[]).includes(rawCategory)
    ) {
      throw badRequest(`category must be one of ${SESSION_CATEGORIES.join(" / ")}.`);
    }
    if (rawCategory !== undefined && paging === null) throw badRequest("category requires limit.");
    return c.json(
      await deps.traceService.agentTraces(
        projectId,
        agentId,
        paging,
        rawCategory as SessionCategory | undefined,
      ),
    );
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
