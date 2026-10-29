/**
 * The history stream routes every server serves for its own Sessions:
 *
 *   GET /api/sessions/:sessionId/history-lines   the machine leg (services/history-lines.ts):
 *                                                a hub reads a Session on this server through it
 *   GET /api/sessions/:sessionId/trace-body?ref=  one value a history window folded, whole
 *
 * Both are streams, paced by the reader's acks over the API socket (`x-flow: credit`); over
 * HTTP they answer as SSE text. A Session of a machine never reaches here on the hub: the
 * Session forward ahead of this group (machines/session-forward.ts) takes it.
 *
 * A ref is the client's to send back, so it authorises nothing by itself: `trace-body` serves
 * it only when its Agent and Session ids are ids, and its Session is the path's Session or one
 * of that Session's descendants (the subagent Sessions its history expands). The line is read
 * from the file that Session's own index locates — no lookup ever runs under a ref's ids.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import fs from "node:fs/promises";
import { isValidId } from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { bodyAt, decodeBodyRef } from "@prismshadow/penguin-core/interfaces";
import type { HistoryProgress, HistoryRecords } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { SessionRow } from "../../db/repos/sessions.js";
import { Channels, Log } from "../../hmr/capabilities.js";
import type { Access } from "../../mechanisms/projects.js";
import type { SessionIndex } from "../../mechanisms/sessions.js";
import type { Traces } from "../../mechanisms/traces.js";
import { Sessions } from "../../runtime/session-manager.js";
import {
  HISTORY_LINES_BEAT_MS,
  parseHistoryLinesQuery,
  planHistoryLines,
  sendHistoryLines,
  sendHistoryLinesError,
} from "../../services/history-lines.js";
import type { HistoryLinesDeps } from "../../services/history-lines.js";
import { FRAME_TEXT_BUDGET } from "../../socket/line-frames.js";
import { HttpError } from "../errors.js";
import { eventStream } from "../event-stream.js";
import type { EventSink } from "../event-stream.js";
import { badRequest } from "../validate.js";

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
  access: Pick<Access, "requireProjectAccess">;
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

  /**
   * The path's Session, for a caller who may read it. A Session that does not exist is 404
   * `session_not_found`. One the caller may not read is 404 too — its existence is not revealed
   * — except to an admin, who is answered 403 `session_forbidden`: a hub reads its machines as
   * their admin, and must not take a refusal for a deletion (it drops its copy of a Session the
   * machine says is gone).
   */
  const resolveSession = (c: Context<AppEnv>): SessionRow => {
    const sessionId = c.req.param("sessionId");
    const row = sessionId ? deps.sessions.findById(sessionId) : null;
    const missing = () =>
      new HttpError(404, "session_not_found", "Session does not exist or you do not have access.");
    if (!row) throw missing();
    try {
      deps.access.requireProjectAccess(c.var.user.userId, row.projectId);
    } catch {
      if (c.var.user.isAdmin) {
        throw new HttpError(403, "session_forbidden", "This account may not read this Session.");
      }
      throw missing();
    }
    return row;
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

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "HistoryLinesRoutes.routes",
        // After the Session forward (268), which takes a machine's Sessions; beside the Session
        // routes (session-api.sessions, 270), whose paths these are not.
        prefix: "/api/sessions",
        auth: "user",
        order: 272,
      },
    ],
  },
})
export class HistoryLinesRoutes {
  @Use() private readonly traces!: Traces;
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly access!: Access;
  @Use() private readonly manager!: Sessions;
  @Use() private readonly channels!: Channels;
  @Use() private readonly log!: Log;
  @Bind("HistoryLinesRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = historyLinesRoutes({
      traces: this.traces,
      sessions: this.sessionsRepo,
      access: this.access,
      manager: this.manager,
      channels: this.channels,
      log: (line) => this.log.line(line),
    });
  }
}
