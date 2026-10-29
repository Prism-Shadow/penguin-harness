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
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
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
  parseHistoryLinesQuery,
  planHistoryLines,
  sendHistoryLines,
} from "../../services/history-lines.js";
import type { HistoryLinesDeps } from "../../services/history-lines.js";
import { FRAME_TEXT_BUDGET } from "../../socket/line-frames.js";
import { HttpError } from "../errors.js";
import { eventStream } from "../event-stream.js";
import type { EventSink } from "../event-stream.js";
import { badRequest } from "../validate.js";

export interface HistoryLinesRouteDeps extends HistoryLinesDeps {
  traces: HistoryLinesDeps["traces"] & Pick<Traces, "readEvents">;
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

  const resolveSession = (c: Context<AppEnv>): SessionRow => {
    const sessionId = c.req.param("sessionId");
    const row = sessionId ? deps.sessions.findById(sessionId) : null;
    const missing = () =>
      new HttpError(404, "session_not_found", "Session does not exist or you do not have access.");
    if (!row) throw missing();
    try {
      deps.access.requireProjectAccess(c.var.user.userId, row.projectId);
    } catch {
      throw missing();
    }
    return row;
  };

  app.get("/:sessionId/history-lines", async (c) => {
    const row = resolveSession(c);
    const query = parseHistoryLinesQuery(new URL(c.req.url));
    const plan = await planHistoryLines(deps, row, query);
    return eventStream(c, (sink) => sendHistoryLines(sink, plan), log);
  });

  app.get("/:sessionId/trace-body", async (c) => {
    const row = resolveSession(c);
    const raw = c.req.query("ref");
    if (raw === undefined) throw badRequest("ref is required.");
    const ref = decodeBodyRef(raw);
    if (ref === null) throw new HttpError(400, "invalid_ref", "ref is not a trace-body ref.");
    // The ref names a line of this Session's Project (a child Session may run under another
    // Agent of it): a ref into a Project the reader cannot see finds nothing there.
    const page = await deps.traces.readEvents(
      row.projectId,
      ref.agentId,
      ref.sessionId,
      ref.fileIndex,
      ref.ordinal,
      1,
    );
    const record = page.events[0];
    const value = record === undefined ? null : bodyAt(record, ref.path);
    if (value === null) {
      throw new HttpError(404, "trace_body_not_found", "The ref names no value of this Session.");
    }
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
