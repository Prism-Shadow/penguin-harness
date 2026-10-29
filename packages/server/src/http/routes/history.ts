/**
 * `GET /api/sessions/:sessionId/history` for this server's own Sessions (spec 05 「历史流」):
 * the window `/messages` answers for the same query, as a stream of whole-record lines with
 * their bulky values elided (services/history-stream.ts). A Session another machine holds never
 * gets here: the hub answers it from its copy of that machine's lines, in front of this group
 * (machines/history-routes.ts, reached through the Session forward at 268 and the
 * `/server/<id>` proxy).
 *
 * Query: `tailLimit=n` · `before=<cursor>&limit=n` · none (the whole transcript), as `/messages`
 * reads them, plus `budget=<bytes>` and `fill=1`. A local Session holds all of its history, so
 * its fill is over as soon as it is asked for: `filled` follows `done` at once, and
 * `fill=only` answers `filled` alone.
 *
 * Every failure, a missing Session included, is the stream's terminal `error` event rather than
 * a status: a stream answered with a status is one the socket client issues again.
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import type { SessionRow } from "../../db/repos/sessions.js";
import type { Channels } from "../../hmr/capabilities.js";
import type { Access } from "../../mechanisms/projects.js";
import type { SessionIndex } from "../../mechanisms/sessions.js";
import type { Traces } from "../../mechanisms/traces.js";
import type { Sessions as ManagerIface } from "../../runtime/session-manager.js";
import {
  HeldWindows,
  openHistoryOut,
  parseHistoryQuery,
  resumePoint,
  sendError,
  sendWindow,
  serializeWindow,
} from "../../services/history-stream.js";
import type { HistoryOut, HistoryQuery } from "../../services/history-stream.js";
import {
  captureHistoryEnvelope,
  historyResponse,
  messagesPageInfo,
} from "../../services/session-history.js";
import type { SessionHistoryDeps } from "../../services/session-history.js";
import { SESSION_ROUTES_BASE } from "../../services/trace-images.js";
import { HttpError } from "../errors.js";

export interface HistoryRouteDeps {
  sessions: Pick<SessionIndex, "findById">;
  access: Pick<Access, "requireProjectAccess">;
  traces: Pick<Traces, "readHistoryWindow">;
  manager: SessionHistoryDeps["manager"];
  channels: SessionHistoryDeps["channels"];
  /** The windows sent lately, for a re-issued stream to continue (one per route group otherwise). */
  windows?: HeldWindows;
  now?: () => number;
}

const notFound = (): HttpError =>
  new HttpError(404, "session_not_found", "Session does not exist or you do not have access.");

/** One local history stream, from its parsed query to its end. */
async function serveHistory(
  out: HistoryOut,
  deps: HistoryRouteDeps,
  windows: HeldWindows,
  row: SessionRow,
  query: HistoryQuery,
  lastEventId: string | null,
): Promise<void> {
  if (query.kind === "fill") {
    await out.send("filled", null, "{}");
    return;
  }
  const resume = resumePoint(lastEventId);
  const held = resume !== null ? windows.find(resume.windowId) : null;
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
    windows.hold(window);
  }
  await sendWindow(out, window, held !== null ? resume!.offset : null);
  if (query.fill) await out.send("filled", null, "{}");
}

export function historyRoutes(deps: HistoryRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const windows = deps.windows ?? new HeldWindows(deps.now);
  app.get("/:sessionId/history", (c) => {
    const { out, response } = openHistoryOut(c.req.raw);
    const lastEventId = c.req.header("last-event-id") ?? null;
    void (async () => {
      try {
        const row = deps.sessions.findById(c.req.param("sessionId"));
        if (row === null) throw notFound();
        try {
          deps.access.requireProjectAccess(c.var.user.userId, row.projectId);
        } catch {
          throw notFound();
        }
        const query = parseHistoryQuery((name) => c.req.query(name));
        await serveHistory(out, deps, windows, row, query, lastEventId);
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

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "HistoryRoutes.routes",
        // After the Session forward (268), which answers a machine's Session first, and ahead
        // of the Session routes (session-api.sessions, 270).
        prefix: "/api/sessions",
        auth: "user",
        order: 269,
      },
    ],
  },
})
export class HistoryRoutes {
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly access!: Access;
  @Use() private readonly traces!: Traces;
  @Use() private readonly manager!: ManagerIface;
  @Use() private readonly channels!: Channels;
  @Bind("HistoryRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = historyRoutes({
      sessions: this.sessionsRepo,
      access: this.access,
      traces: this.traces,
      manager: this.manager,
      channels: this.channels,
    });
  }
}
