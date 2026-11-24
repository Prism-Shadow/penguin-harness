/**
 * The trace domain's route factories, as the server's assemblies reach them (restack S9e):
 * the Agent-level Trace browsing group, the web leg of the history stream and the machine
 * leg. Each takes its deps as plain shapes — the module that builds the routes binds them to
 * its own capabilities — and contributes its Hono group; the assembly lives in the server.
 *
 * The Session rule every group resolves by is the sessions library's `readableSession` (the
 * server re-exports it as its own): a Session that does not exist is 404 `session_not_found`,
 * one the caller may not read is 404 as well (existence is not revealed), and an admin is told
 * 403 `session_forbidden`.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import fs from "node:fs/promises";
import { isValidId } from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { bodyAt, decodeBodyRef } from "@prismshadow/penguin-core/interfaces";
import type { AppEnv } from "@prismshadow/penguin-library-http";
import { HttpError } from "@prismshadow/penguin-library-http/errors";
import {
  badRequest,
  optionalPagingQuery,
  paginationQuery,
  positiveIntParam,
  readJson,
  requireString,
  requireValidId,
} from "@prismshadow/penguin-library-http/validate";
import { eventStream } from "@prismshadow/penguin-library-http/event-stream";
import type { EventSink } from "@prismshadow/penguin-library-http/event-stream";
import { FRAME_TEXT_BUDGET } from "@prismshadow/penguin-library-http/socket-line-frames";
import type { SessionRow } from "@prismshadow/penguin-library-session/repos/sessions";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import { readableSession } from "@prismshadow/penguin-library-session/access";
import type {
  HistoryProgress,
  HistoryRecords,
  SessionCategory,
  TraceImportResponse,
  Traces,
} from "./trace.js";
import {
  HeldWindows,
  openHistoryOut,
  parseHistoryQuery,
  resumePoint,
  sendError,
  sendWindow,
  serializeWindow,
} from "./history-stream.js";
import type { HistoryOut, HistoryQuery, SseRevocation } from "./history-stream.js";
import { captureHistoryEnvelope, historyResponse, messagesPageInfo } from "./session-history.js";
import type { SessionHistoryDeps } from "./session-history.js";
import { SESSION_ROUTES_BASE } from "./trace-images.js";
import {
  HISTORY_LINES_BEAT_MS,
  parseHistoryLinesQuery,
  planHistoryLines,
  sendHistoryLines,
  sendHistoryLinesError,
} from "./history-lines.js";
import type { HistoryLinesDeps } from "./history-lines.js";

/**
 * The Project row an access check hands back (server `ProjectRow`, the project repos' row): a
 * structural mirror — this package must not import the project library, which itself reads the
 * trace one.
 */
export interface TraceProjectRow {
  projectId: string;
  ownerUserId: string;
  createdAt: string;
}

/** The row with the caller's standing in it (server `ProjectRow & { role: ProjectRole }`). */
export interface TraceAccessibleProjectRow extends TraceProjectRow {
  role: "owner" | "member";
}

/** The access check the route groups reach: one call each (server `Access`). */
export interface TraceAccess {
  requireProjectAccess(userId: string, projectId: string): TraceAccessibleProjectRow;
  requireProjectOwner(userId: string, projectId: string): TraceProjectRow;
}

/** The agent-config surface the import route checks (server `AgentConfig`). */
export interface TraceAgentConfig {
  requireExists(projectId: string, agentId: string): Promise<void>;
}

/**
 * Agent-level Trace browsing routes:
 *   - GET /api/projects/:p/agents/:a/traces — Agent-level listing, served from the
 *     trace-file index (mtime-gated reconcile, then pure DB — see services/trace-index.ts).
 *     Without `limit`: the legacy full drill-down (Agent -> date -> Session -> index,
 *     reverse order), never filtered. With optional `offset`/`limit` (+ optional
 *     `category`): pages Session groups newest-first (within the category when
 *     given), stat-ing only the returned page for fresh sizes, and resolves per group a
 *     display title (sessions DB title, else the registration-time first-prompt
 *     fallback) plus its sidebar category / Workspace and per-category totals. Every
 *     Session is listed whichever client created it, but a company Session, which no category
 *     holds (company mode's own views list it).
 *     The listing consults the sessions table read-only (titles, archived, workspace,
 *     client); discovery itself still comes from the Trace directory tree via the index.
 *   - GET /api/projects/:p/agents/:a/traces/:sessionId/:index (including /analysis, /download) —
 *     read-only Trace detail endpoints: locate the Trace file directly by
 *     (projectId, agentId, sessionId), without depending on the sessions table for
 *     tracking — any entry visible in the directory tree (subagent child Sessions,
 *     CLI-created Sessions) can be opened and read; access is enforced by requireProjectAccess.
 *   - POST /api/projects/:p/agents/:a/traces/import — uploads a Trace JSONL file (owner
 *     only, mirroring the Agent snapshot import); the file names itself via its
 *     session_meta and always becomes index 001 of a new Session — a session id the
 *     Agent already has is rejected with 409 trace_session_exists.
 */
/** What this route group reaches — bound by its module (src/modules). */
/** Import file size cap: aligned with the snapshot import (stays within the 20MB body limit after base64). */
const MAX_TRACE_BYTES = 14 * 1024 * 1024;

/** Accepted `category` query values of the paginated listing (SessionCategory, spelled out for validation — same as the sessions list route). */
const SESSION_CATEGORIES: readonly SessionCategory[] = ["active", "archived"];

export interface AgentTracesRouteDeps {
  agentConfigService: TraceAgentConfig;
  access: TraceAccess;
  traceService: Traces;
}

export function agentTracesRoutes(deps: AgentTracesRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Id validation happens before any path construction: prevents agentId path traversal for cross-Project privilege escalation.
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
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
      await deps.traceService.agentTraces(projectId, agentId, paging, {
        ...(rawCategory !== undefined ? { category: rawCategory as SessionCategory } : {}),
      }),
    );
  });

  app.get("/:sessionId/:index", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const sessionId = requireValidId(c, "sessionId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
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
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const index = positiveIntParam(c, "index");
    return c.json(await deps.traceService.analyze(projectId, agentId, sessionId, index));
  });

  // Raw-file download (any member, like the Agent export): the file is served verbatim
  // as an attachment, so what's downloaded can be re-imported byte-compatibly.
  app.get("/:sessionId/:index/download", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const sessionId = requireValidId(c, "sessionId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
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
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
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

/** One local history stream, from its parsed query to its end. */
async function serveHistory(
  out: HistoryOut,
  deps: HistoryRouteDeps,
  windows: HeldWindows,
  row: SessionRow,
  query: HistoryQuery,
  lastEventId: string | null,
  userId: string,
): Promise<void> {
  if (query.kind === "fill") {
    await out.send("filled", null, "{}");
    return;
  }
  const owner = { sessionId: row.sessionId, userId, query: JSON.stringify(query) };
  const resume = resumePoint(lastEventId);
  const held = resume !== null ? windows.find(resume.windowId, owner) : null;
  let window = held;
  if (window === null) {
    const envelope = captureHistoryEnvelope(deps, row.sessionId, query.read.kind);
    const read = await deps.traces.readHistoryWindow(
      row.projectId,
      row.agentId,
      row.sessionId,
      query.read,
    );
    const response = historyResponse(
      {
        messages: read.messages,
        ...(read.page !== undefined ? { page: messagesPageInfo(read.page) } : {}),
      },
      envelope,
      row.sessionId,
      SESSION_ROUTES_BASE,
    );
    window = serializeWindow(
      response,
      (_m, i) => read.sources[i] ?? null,
      (deps.now ?? Date.now)(),
    );
    windows.hold(window, owner);
  }
  await sendWindow(out, window, held !== null ? resume!.offset : null);
  if (query.fill) await out.send("filled", null, "{}");
}

export interface HistoryRouteDeps {
  sessions: Pick<SessionIndex, "findById">;
  access: Pick<TraceAccess, "requireProjectAccess">;
  traces: Pick<Traces, "readHistoryWindow">;
  manager: SessionHistoryDeps["manager"];
  channels: SessionHistoryDeps["channels"];
  /** The windows sent lately, for a re-issued stream to continue (one per route group otherwise). */
  windows?: HeldWindows;
  /**
   * What an HTTP stream is held against: signing out ends it (the server's http/sse.ts). The
   * registry is the server's; the routes only hand the stream the revocation it answers.
   */
  revocation?: (c: Context<AppEnv>, user: { userId: string }) => SseRevocation | undefined;
  now?: () => number;
}

export function historyRoutes(deps: HistoryRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const windows = deps.windows ?? new HeldWindows(deps.now);
  app.get("/:sessionId/history", (c) => {
    const revocation = deps.revocation?.(c, c.var.user);
    const { out, response } = openHistoryOut(
      c.req.raw,
      revocation !== undefined ? { revocation } : {},
    );
    const lastEventId = c.req.header("last-event-id") ?? null;
    void (async () => {
      try {
        // The rule every Session route resolves by: a refused admin is told so (403
        // `session_forbidden`), anyone else finds nothing.
        const row = readableSession(
          deps.sessions.findById(c.req.param("sessionId")),
          c.var.user,
          deps.access,
        );
        const query = parseHistoryQuery((name) => c.req.query(name));
        await serveHistory(out, deps, windows, row, query, lastEventId, c.var.user.userId);
      } catch (err) {
        if (!out.signal.aborted) await sendError(out, err);
      } finally {
        out.end();
      }
    })();
    return response;
  });
  return app;
}

/** Bytes [start, end) of a file. */
async function readLine(path: string, start: number, end: number): Promise<Buffer> {
  const fh = await fs.open(path, "r");
  try {
    const buf = Buffer.alloc(end - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export interface HistoryLinesRouteDeps extends HistoryLinesDeps {
  sessions: Pick<SessionIndex, "findById">;
  access: Pick<TraceAccess, "requireProjectAccess">;
  log?: (line: string) => void;
}

/** The value as `part` events of at most a frame each, never cutting a surrogate pair. */
async function sendBody(sink: EventSink, ref: string, value: string): Promise<void> {
  const totalBytes = Buffer.byteLength(value, "utf8");
  const progress = (doneBytes: number): HistoryProgress => ({
    phase: "heavy",
    machineId: null,
    doneBytes,
    totalBytes,
    doneLines: doneBytes === totalBytes ? 1 : 0,
    totalLines: 1,
    waiting: null,
  });
  const emit = async (event: string, payload: unknown): Promise<void> => {
    const data = JSON.stringify(payload);
    await sink.writable(data.length);
    await sink.send(event, null, data);
  };
  await emit("progress", progress(0));
  let offset = 0;
  let doneBytes = 0;
  do {
    let end = Math.min(value.length, offset + FRAME_TEXT_BUDGET);
    if (end < value.length && (value.charCodeAt(end - 1) & 0xfc00) === 0xd800) end -= 1;
    const text = value.slice(offset, end);
    const part: HistoryRecords = { windowId: ref, offset, text, last: end === value.length };
    await emit("part", part);
    doneBytes += Buffer.byteLength(text, "utf8");
    offset = end;
  } while (offset < value.length);
  await emit("progress", progress(doneBytes));
  await emit("done", {});
}

export function historyLinesRoutes(deps: HistoryLinesRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const log = deps.log ?? (() => undefined);

  /** The path's Session, for a caller who may read it (the sessions library's one rule). */
  const resolveSession = (c: Context<AppEnv>): SessionRow => {
    const sessionId = c.req.param("sessionId");
    const row = sessionId ? deps.sessions.findById(sessionId) : null;
    return readableSession(row, c.var.user, deps.access);
  };

  app.get("/:sessionId/history-lines", (c) => {
    const row = resolveSession(c);
    const query = parseHistoryLinesQuery(new URL(c.req.url));
    // The stream starts, and beats, before the plan reads anything: a large Session's plan
    // takes a while, and the hub ends a machine stream it has not heard from in seconds.
    return eventStream(
      c,
      async (sink) => {
        sink.beat(HISTORY_LINES_BEAT_MS);
        let plan;
        try {
          plan = await planHistoryLines(deps, row, query);
        } catch (err) {
          if (!(err instanceof HttpError)) throw err;
          await sendHistoryLinesError(sink, err);
          return;
        }
        await sendHistoryLines(sink, plan);
      },
      log,
    );
  });

  app.get("/:sessionId/trace-body", async (c) => {
    const row = resolveSession(c);
    const raw = c.req.query("ref");
    const notFound = () =>
      new HttpError(404, "trace_body_not_found", "The ref names no value of this Session.");
    if (raw === undefined) throw badRequest("ref is required.");
    const ref = decodeBodyRef(raw);
    // Ids first, before anything is located by them (core's isValidId: no `..`, no `/`).
    if (ref === null || !isValidId(ref.agentId) || !isValidId(ref.sessionId)) throw notFound();
    // Then the ref's Session must be this one or one of its descendants: the files listed are
    // those this Session's own Traces lead to, and only they are read.
    const files = await deps.traces.historyTraceFiles(row.projectId, row.agentId, row.sessionId);
    const file = files.find(
      (f) =>
        f.agentId === ref.agentId && f.sessionId === ref.sessionId && f.fileIndex === ref.fileIndex,
    );
    const start = file?.starts[ref.ordinal];
    const end = file?.ends[ref.ordinal];
    if (file === undefined || start === undefined || end === undefined) throw notFound();
    let record: AmspRecord;
    try {
      record = JSON.parse((await readLine(file.path, start, end)).toString("utf8")) as AmspRecord;
    } catch {
      throw notFound(); // replaced since it was indexed
    }
    const value = bodyAt(record, ref.path);
    if (value === null) throw notFound();
    return eventStream(c, (sink) => sendBody(sink, raw, value), log);
  });

  return app;
}
