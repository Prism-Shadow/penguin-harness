/**
 * Session routes.
 *
 * Two entry groups:
 *   - Agent-level: GET|POST /api/projects/:p/agents/:a/sessions (list including run state / create);
 *   - Session-level: /api/sessions/:sessionId/* (no projectId; looks up project_id via the
 *     sessions index, then goes through requireProjectAccess; 404 if the index has no such Session).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { imageUrlMessage, scratchpadDir, userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type {
  ApprovalMode,
  FilesStatResponse,
  MessagesResponse,
  ServerEvent,
  SessionCreateResponse,
  SessionResponse,
  SessionsResponse,
  TaskCreateResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { SessionRow } from "../../db/repos/sessions.js";
import { assertWorkspaceAllowed } from "../../services/workspace-guard.js";
import { HttpError } from "../errors.js";
import { sseEndpoint } from "../sse.js";
import {
  badRequest,
  optionalEnum,
  optionalString,
  paginationQuery,
  pathParam,
  positiveIntParam,
  readJson,
  requireEnum,
  requireValidId,
} from "../validate.js";
import type { AppDeps } from "../../app.js";
import { MAX_UPLOAD_BYTES } from "../../services/workspace-files-service.js";

/** Max title length for manual renames: looser than the auto-generated 30-char limit, to accommodate users' own organizing conventions. */
const SESSION_TITLE_MAX = 120;

/** Max path count and per-path length for a single files/stat check (message file-card candidates never exceed this scale). */
const STAT_MAX_PATHS = 100;
const STAT_MAX_PATH_LEN = 512;

const APPROVAL_MODES: readonly ApprovalMode[] = [
  "allow-all",
  "deny-all",
  "read-only",
  "always-ask",
];

/** Validate Prompt input parts: text or image (data: / http(s) URL). */
function parseTaskInput(body: Record<string, unknown>): OmniMessage[] {
  const input = body.input;
  if (!Array.isArray(input) || input.length === 0) {
    throw badRequest("input must be an array with at least one item.");
  }
  return input.map((item, i) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw badRequest(`input[${i}] must be an object.`);
    }
    const part = item as Record<string, unknown>;
    if (part.type === "text") {
      if (typeof part.text !== "string" || part.text.length === 0) {
        throw badRequest(`input[${i}].text must be a non-empty string.`);
      }
      return userText(part.text);
    }
    if (part.type === "image_url") {
      const url = part.imageUrl;
      if (
        typeof url !== "string" ||
        !(url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://"))
      ) {
        throw badRequest(`input[${i}].imageUrl only supports data: or http(s) URLs.`);
      }
      return imageUrlMessage(url);
    }
    throw badRequest(`input[${i}].type must be one of text / image_url.`);
  });
}

/** Agent-level entry: /api/projects/:p/agents/:a/sessions. */
export function agentSessionsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Id validity is checked before any path is constructed (FD-4: guards against agentId path traversal across Projects).
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const sessions = await deps.sessionService.listSessions(projectId, agentId);
    return c.json({ sessions } satisfies SessionsResponse);
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const body = await readJson(c);
    const modelId = optionalString(body, "modelId", { minLen: 1, label: "modelId" });
    const provider = optionalString(body, "provider", { minLen: 1, label: "provider" });
    // Model reference is submitted as a pair: provider can't appear without modelId (core does the same validation; this catches it early).
    if (provider !== undefined && modelId === undefined) {
      throw badRequest(
        "provider is specified but modelId is not: a model reference must be given as a pair.",
      );
    }
    const approvalMode = optionalEnum(body, "approvalMode", APPROVAL_MODES);
    let workspace = optionalString(body, "workspace", { minLen: 1, label: "workspace" });
    if (workspace !== undefined) {
      // An explicitly specified Workspace must be an existing directory (never auto-created); reachability is determined by file permissions.
      workspace = await assertWorkspaceAllowed({ workspace });
    }
    const session = await deps.sessionService.createSession({
      projectId,
      agentId,
      ...(modelId !== undefined ? { modelId } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(workspace !== undefined ? { workspace } : {}),
      ...(approvalMode !== undefined ? { approvalMode } : {}),
    });
    return c.json({ session } satisfies SessionCreateResponse, 201);
  });

  return app;
}

/** Session-level entry point: /api/sessions/:sessionId/*. */
export function sessionsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Look up ownership and check access (404 if the index has no such Session, or access is denied — never leaking existence). */
  const resolveSession = (c: Context<AppEnv>): SessionRow => {
    const sessionId = c.req.param("sessionId");
    const row = sessionId ? deps.sessionsRepo.findById(sessionId) : null;
    if (!row) {
      throw new HttpError(
        404,
        "session_not_found",
        "Session does not exist or you do not have access.",
      );
    }
    try {
      deps.projectService.requireProjectAccess(c.var.user.userId, row.projectId);
    } catch {
      throw new HttpError(
        404,
        "session_not_found",
        "Session does not exist or you do not have access.",
      );
    }
    return row;
  };

  app.get("/:sessionId", async (c) => {
    const row = resolveSession(c);
    const hasTrace = await deps.sessionService.hasTrace(row);
    return c.json({ session: deps.sessionService.toInfo(row, hasTrace) } satisfies SessionResponse);
  });

  app.patch("/:sessionId", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const approvalMode = optionalEnum(body, "approvalMode", APPROVAL_MODES);
    const archivedRaw = (body as Record<string, unknown>).archived;
    const archived = typeof archivedRaw === "boolean" ? archivedRaw : undefined;
    const titleRaw = (body as Record<string, unknown>).title;
    let title: string | undefined;
    if (titleRaw !== undefined) {
      if (typeof titleRaw !== "string") {
        throw new HttpError(400, "invalid_title", "title must be a string.");
      }
      title = titleRaw.trim();
      if (!title || title.length > SESSION_TITLE_MAX) {
        throw new HttpError(
          400,
          "invalid_title",
          `title must be 1–${SESSION_TITLE_MAX} characters.`,
        );
      }
    }
    if (approvalMode === undefined && archived === undefined && title === undefined) {
      throw new HttpError(
        400,
        "no_update",
        "No updatable field provided (approvalMode / archived / title).",
      );
    }
    let updated: SessionRow = { ...row };
    if (title !== undefined) {
      // Manual renaming takes priority over auto-generation: TitleGenerator only persists a title while it's still NULL.
      deps.sessionsRepo.updateTitle(row.sessionId, title);
      updated = { ...updated, title };
    }
    if (approvalMode !== undefined) {
      // Takes effect immediately: a running approve callback re-reads the DB on every decision.
      deps.sessionsRepo.updateApprovalMode(row.sessionId, approvalMode);
      updated = { ...updated, approvalMode };
    }
    if (archived !== undefined) {
      const at = archived ? new Date().toISOString() : null;
      deps.sessionsRepo.setArchived(row.sessionId, at);
      updated = { ...updated, archivedAt: at };
    }
    const hasTrace = await deps.sessionService.hasTrace(updated);
    return c.json({
      session: deps.sessionService.toInfo(updated, hasTrace),
    } satisfies SessionResponse);
  });

  app.delete("/:sessionId", async (c) => {
    const row = resolveSession(c);
    // Mark as being deleted and converge active runs (beginSessionDeletion): new
    // Tasks/compactions are always rejected with 409 during this window
    // (assertSessionNotDeleting), preventing the race where a new task recreates the
    // entry and Trace after abort but before the files are deleted, reviving an
    // already-deleted Session. Interrupt cleanup writes the Trace asynchronously, so we
    // wait for it to finish (≤5s cap) before deleting the files and index row; the
    // being-deleted marker is cleared once deletion finishes (success or failure).
    const runnings = deps.manager.beginSessionDeletion(row.sessionId);
    try {
      if (runnings.length > 0) {
        await Promise.race([
          Promise.allSettled(runnings).then(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, 5000).unref?.()),
        ]);
      }
      await deps.traceService.deleteSessionTraces(row.projectId, row.agentId, row.sessionId);
      // The session-level scratchpad (model temp files + input images saved to disk for image-unsupported models) is deleted along with the session.
      await fs.rm(
        path.join(scratchpadDir(deps.config.root, row.projectId, row.agentId), row.sessionId),
        { recursive: true, force: true },
      );
      deps.sessionsRepo.deleteById(row.sessionId);
    } finally {
      deps.manager.endSessionDeletion(row.sessionId);
    }
    return c.body(null, 204);
  });

  // Session scratchpad files (e.g. input images saved to disk for image-unsupported
  // models): read by filename, so the conversation UI can render a message's
  // "[attached image: <path>]" attachment line back into an image. Restricted to this
  // session's own scratchpad directory (the filename must not contain a path
  // separator, blocking traversal); filenames include a timestamp and are globally
  // unique, so the response is marked immutable and long-cacheable.
  app.get("/:sessionId/scratchpad/:fileName", async (c) => {
    const row = resolveSession(c);
    const fileName = c.req.param("fileName") ?? "";
    if (!/^[A-Za-z0-9._-]+$/.test(fileName) || fileName.includes("..")) {
      throw new HttpError(404, "file_not_found", "File does not exist.");
    }
    const filePath = path.join(
      scratchpadDir(deps.config.root, row.projectId, row.agentId),
      row.sessionId,
      fileName,
    );
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(filePath);
    } catch {
      throw new HttpError(404, "file_not_found", "File does not exist.");
    }
    const MIME_BY_EXT: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    const mime = MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": mime,
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  app.get("/:sessionId/messages", async (c) => {
    const row = resolveSession(c);
    const messages = await deps.traceService.readMessages(
      row.projectId,
      row.agentId,
      row.sessionId,
    );
    return c.json({ messages } satisfies MessagesResponse);
  });

  app.get("/:sessionId/stream", (c) => {
    const row = resolveSession(c);
    const channel = deps.channels.get(row.sessionId);
    // FD-1: the first event of every new subscription (including reconnects and resync
    // rebuilds) is always a snapshot of the current running state — the frontend treats
    // this as authoritative, eliminating input-area lockup or premature Task closure
    // caused by a stale running/idle in the list; followed by replaying all still-pending
    // approval requests.
    const initialEvents: ServerEvent[] = [
      { type: "task_state", state: deps.manager.statusOf(row.sessionId) },
      ...deps.manager.pendingApprovals(row.sessionId).map((p) => ({
        type: "approval_request" as const,
        toolCall: p.toolCall,
        ...(p.origin !== undefined ? { origin: p.origin } : {}),
      })),
    ];
    return sseEndpoint(c, channel, { initialEvents });
  });

  app.post("/:sessionId/tasks", async (c) => {
    const row = resolveSession(c);
    const input = parseTaskInput(await readJson(c));
    // 202: the Task executes on the server, decoupled from the SSE connection; sessionId is the current actual id (the new id after self-heal).
    const { sessionId } = await deps.manager.startTask(row.sessionId, input);
    return c.json({ sessionId } satisfies TaskCreateResponse, 202);
  });

  app.post("/:sessionId/approvals/:toolCallId", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const decision = requireEnum(body, "decision", ["allow", "deny"] as const);
    const ok = deps.manager.decideApproval(row.sessionId, pathParam(c, "toolCallId"), decision);
    if (!ok) {
      throw new HttpError(
        404,
        "approval_not_found",
        "Approval does not exist or has already been decided.",
      );
    }
    return c.body(null, 204);
  });

  app.post("/:sessionId/abort", (c) => {
    const row = resolveSession(c);
    const aborted = deps.manager.abortTask(row.sessionId);
    // No Task in progress → 204 no-op; interrupt was triggered → 202 (wrap-up is completed by the SDK's "interrupt cleanup").
    return c.body(null, aborted ? 202 : 204);
  });

  app.post("/:sessionId/compact", async (c) => {
    const row = resolveSession(c);
    const { sessionId } = await deps.manager.startCompact(row.sessionId);
    return c.json({ sessionId } satisfies TaskCreateResponse, 202);
  });

  // —— Workspace file browsing (Files tab) ——

  app.get("/:sessionId/files", async (c) => {
    const row = resolveSession(c);
    const rel = c.req.query("path") ?? "";
    return c.json(await deps.workspaceFiles.list(row.workspace, rel));
  });

  app.get("/:sessionId/files/content", async (c) => {
    const row = resolveSession(c);
    const rel = c.req.query("path") ?? "";
    const download = c.req.query("download") === "1";
    const { data, fileName, contentType, scriptable } = await deps.workspaceFiles.read(
      row.workspace,
      rel,
    );
    const disposition = download ? "attachment" : "inline";
    // Same-origin XSS defense: html/svg inline previews are always returned as plain
    // text (Workspace files may be Agent-generated and untrusted); downloads
    // (attachment) keep the real content type. Paired with nosniff to prevent MIME
    // sniffing from undoing this.
    const effectiveType = !download && scriptable ? "text/plain; charset=utf-8" : contentType;
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": effectiveType,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  // Bulk existence check (message file cards list only files that actually exist):
  // path-confinement resolution shares the same logic as files/content
  // (WorkspaceFilesService.statExisting reuses resolveRead); out-of-bounds or
  // resolution failures count as not-existing, always 200 — existence itself is the
  // question being answered, and a 4xx would only leak confinement details.
  app.post("/:sessionId/files/stat", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const paths = body.paths;
    if (
      !Array.isArray(paths) ||
      paths.length > STAT_MAX_PATHS ||
      !paths.every((p) => typeof p === "string" && p.length <= STAT_MAX_PATH_LEN)
    ) {
      throw badRequest(
        `paths must be an array of strings (≤${STAT_MAX_PATHS} items, each ≤${STAT_MAX_PATH_LEN} characters).`,
      );
    }
    const existing = await deps.workspaceFiles.statExisting(row.workspace, paths as string[]);
    return c.json({ existing } satisfies FilesStatResponse);
  });

  app.put("/:sessionId/files/content", async (c) => {
    const row = resolveSession(c);
    const rel = c.req.query("path") ?? "";
    const body = await readJson(c);
    if (typeof body.dataBase64 !== "string") {
      throw badRequest("dataBase64 must be a base64 string.");
    }
    const data = Buffer.from(body.dataBase64, "base64");
    if (data.length > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, "file_too_large", "Uploaded file exceeds the 14MB limit.");
    }
    await deps.workspaceFiles.write(row.workspace, rel, data);
    return c.body(null, 204);
  });

  app.get("/:sessionId/traces", async (c) => {
    const row = resolveSession(c);
    const files = await deps.traceService.listTraceFiles(row.projectId, row.agentId, row.sessionId);
    return c.json({ files });
  });

  app.get("/:sessionId/traces/:index", async (c) => {
    const row = resolveSession(c);
    const index = positiveIntParam(c, "index");
    const { offset, limit } = paginationQuery(c);
    return c.json(
      await deps.traceService.readEvents(
        row.projectId,
        row.agentId,
        row.sessionId,
        index,
        offset,
        limit,
      ),
    );
  });

  app.get("/:sessionId/traces/:index/analysis", async (c) => {
    const row = resolveSession(c);
    const index = positiveIntParam(c, "index");
    return c.json(
      await deps.traceService.analyze(row.projectId, row.agentId, row.sessionId, index),
    );
  });

  return app;
}
