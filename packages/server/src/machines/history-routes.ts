/**
 * The hub's own answers for a machine Session's history (spec 05, "Remote Session history: the
 * machine cuts, this server caches"). In front of the forward to the machine — the `/server/<id>`
 * proxy (proxy.ts) and the Session-level forward (session-forward.ts) ask here first, once they
 * know the machine and before they ask whether it is connected — these reads are answered from
 * the hub's copy of the machine's Trace lines (trace-cache.ts) that the Session's sync job keeps
 * (history-sync.ts); what the copy cannot answer is forwarded as before. A history stream asked
 * for while the machine is away is held open and says so (`progress.waiting`) rather than being
 * refused:
 *
 *  - `GET …/sessions/:id/history` — the window, streamed with progress (services/history-stream.ts);
 *    `fill=only[&file=<index>[&agent=<id>]]` makes the Session, or one of its files, whole;
 *  - `GET …/sessions/:id/trace-body?ref=` — one elided value, whole: from the copy when it holds
 *    the line, else after a priority fetch of that one line;
 *  - `GET …/sessions/:id/trace-image` — from the copy when it holds the record (a record never
 *    changes, the live file's included);
 *  - the Trace panel's events, `GET …/sessions/:id/traces/:index` and
 *    `GET …/projects/:p/agents/:a/traces/:id/:index` — from the copy only for a rotated file it
 *    holds whole: the live file grows on the machine, and its events are the machine's to count.
 *    The Project-scoped path is answered here only when this server knows the Session's Project,
 *    and a Project that is not the Session's finds nothing, as on the machine.
 *
 * The Trace panel's analysis is still the machine's to answer: it prices the file with that
 * machine's Project rates.
 */
import { bodyAt, decodeBodyRef } from "@prismshadow/penguin-core/interfaces";
import type { HistoryFileKey, TraceEventsResponse } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { SseRevocation } from "../http/sse.js";
import {
  HeldWindows,
  ProgressOut,
  openHistoryOut,
  parseHistoryQuery,
  resumePoint,
  sendBody,
  sendError,
  sendWindow,
  serializeWindow,
} from "../services/history-stream.js";
import type { HistoryOut } from "../services/history-stream.js";
import { historyFileKey } from "../services/history-wire.js";
import { traceRecordImage } from "../services/trace-images.js";
import { GenerationClosed, HistorySync } from "./history-sync.js";
import type { HistoryReader, HistorySyncDeps } from "./history-sync.js";
import type { MachineSockets } from "./machine-sockets.js";
import { proxyThroughSession } from "./proxy.js";
import type { ProxyPath, ProxyTarget } from "./proxy.js";
import type { TraceCache } from "./trace-cache.js";

const SESSION_READ = /^\/api\/sessions\/([^/]+)\/(history|trace-body|trace-image)$/;
const SESSION_EVENTS = /^\/api\/sessions\/([^/]+)\/traces\/([1-9]\d{0,5})$/;
const AGENT_EVENTS = /^\/api\/projects\/([^/]+)\/agents\/([^/]+)\/traces\/([^/]+)\/([1-9]\d{0,5})$/;
/** How many Sessions' Projects are remembered for the Project-scoped Trace path. */
const PROJECTS_KEPT = 10_000;

/** A query integer of at least `min`, or null when it is absent or not one (the machine then answers it). */
function intParam(url: URL, name: string, min: number, fallback?: number): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback ?? null;
  if (!/^\d{1,9}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min ? value : null;
}

const decode = (part: string): string | null => {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
};

/** Who is asking, as the route in front of the forward knows it. */
export interface HistoryCaller {
  /** The signed-in user: a held window continues only for the reader it was sent to. */
  userId: string;
  /** The sign-in behind an HTTP stream: signing out ends it (http/sse.ts). */
  revocation?: () => SseRevocation;
  /** The Session's Project on its machine, when the forward has looked it up. */
  projectId?: string;
}

export interface MachineHistoryDeps {
  sync: HistorySync;
  cache: TraceCache;
  windows?: HeldWindows;
}

/**
 * The history answers of one platform generation: the copy (`cache`), one sync job per
 * Session over the generation's machine sockets, and an older machine's `/messages` over the
 * same forward every other one-shot request takes.
 */
export function machineHistory(deps: {
  cache: TraceCache;
  sockets: Pick<MachineSockets, "socketFor">;
  target: (machineId: string) => Promise<ProxyTarget | null>;
  /** Whether this server still lists the machine (a removed machine's reads end with an error). */
  known?: (machineId: string) => boolean;
  /** When bytes last came in from the machine on any of its connections (HistorySyncDeps.heardAt). */
  heardAt?: (machineId: string) => number | null;
  log: (line: string) => void;
  /** The sync's clock and knobs, as a test sets them. */
  tuning?: Pick<
    HistorySyncDeps,
    "clock" | "watchdogMs" | "retryFirstMs" | "retryMaxMs" | "observe"
  >;
}): { history: MachineHistory; sync: HistorySync } {
  const sync = new HistorySync({
    ...deps.tuning,
    cache: deps.cache,
    target: deps.target,
    ...(deps.known !== undefined ? { known: deps.known } : {}),
    ...(deps.heardAt !== undefined ? { heardAt: deps.heardAt } : {}),
    socket: (machineId, target) => deps.sockets.socketFor(machineId, target),
    http: (machineId, target, remote, signal) => {
      const url = new URL(remote, "http://localhost");
      return proxyThroughSession(
        new Request(url, { signal }),
        { machineId, remotePath: url.pathname },
        target,
      );
    },
    log: deps.log,
  });
  return { history: new MachineHistory({ sync, cache: deps.cache }), sync };
}

/** The hub's history answers for machine Sessions, over one platform generation's sync jobs. */
export class MachineHistory {
  readonly #sync: HistorySync;
  readonly #cache: TraceCache;
  readonly #windows: HeldWindows;
  /** Each Session's Project on its machine, as the Session forward found it (`<machineId>\0<sessionId>`). */
  readonly #projects = new Map<string, string>();

  constructor(deps: MachineHistoryDeps) {
    this.#sync = deps.sync;
    this.#cache = deps.cache;
    this.#windows = deps.windows ?? new HeldWindows();
  }

  /**
   * The hub's answer to a request for one machine's API, or null when it is not one of the
   * reads above, or the copy cannot answer it: the caller then forwards it as before.
   */
  async answer(
    request: Request,
    path: ProxyPath,
    caller: HistoryCaller = { userId: "" },
  ): Promise<Response | null> {
    if (request.method !== "GET") return null;
    const url = new URL(request.url);
    const { machineId, remotePath } = path;
    const read = SESSION_READ.exec(remotePath);
    if (read !== null) {
      const sessionId = decode(read[1]!);
      if (sessionId === null) return null;
      if (caller.projectId !== undefined)
        this.#rememberProject(machineId, sessionId, caller.projectId);
      if (read[2] === "history") return this.#history(request, url, machineId, sessionId, caller);
      if (read[2] === "trace-body") {
        return this.#traceBody(request, url, machineId, sessionId, caller);
      }
      return this.#traceImage(url, machineId, sessionId);
    }
    const sessionEvents = SESSION_EVENTS.exec(remotePath);
    if (sessionEvents !== null) {
      const sessionId = decode(sessionEvents[1]!);
      if (sessionId === null) return null;
      const k = await this.#cache.ownFileKey(machineId, sessionId, Number(sessionEvents[2]));
      return k === null ? null : this.#traceEvents(url, machineId, k);
    }
    const agentEvents = AGENT_EVENTS.exec(remotePath);
    if (agentEvents !== null) {
      const projectId = decode(agentEvents[1]!);
      const agentId = decode(agentEvents[2]!);
      const sessionId = decode(agentEvents[3]!);
      if (projectId === null || agentId === null || sessionId === null) return null;
      // Only a Session whose Project this server knows; any other Project holds no such file.
      const known = this.#projects.get(`${machineId}\0${sessionId}`);
      if (known === undefined) return null;
      if (known !== projectId) {
        return Response.json(
          {
            error: {
              code: "trace_not_found",
              message: `This Session has no Trace file with index ${agentEvents[4]}.`,
            },
          },
          { status: 404 },
        );
      }
      return this.#traceEvents(
        url,
        machineId,
        historyFileKey(agentId, sessionId, Number(agentEvents[4])),
      );
    }
    return null;
  }

  #rememberProject(machineId: string, sessionId: string, projectId: string): void {
    const key = `${machineId}\0${sessionId}`;
    this.#projects.delete(key);
    this.#projects.set(key, projectId);
    if (this.#projects.size > PROJECTS_KEPT) {
      this.#projects.delete(this.#projects.keys().next().value!);
    }
  }

  /** Runs one stream's work with a reader of the Session's job, then ends the stream. */
  #stream(
    request: Request,
    machineId: string,
    sessionId: string,
    caller: HistoryCaller,
    work: (out: HistoryOut, reader: HistoryReader, progress: ProgressOut) => Promise<void>,
  ): Response {
    const revocation = caller.revocation?.();
    const { out, response } = openHistoryOut(
      request,
      revocation !== undefined ? { revocation } : {},
    );
    void (async () => {
      const reader = this.#sync.reader(machineId, sessionId, out.signal);
      const progress = new ProgressOut(out);
      try {
        await work(out, reader, progress);
      } catch (err) {
        // A replaced generation ends the stream with no error: the reader asks its successor.
        if (!out.signal.aborted && !(err instanceof GenerationClosed)) {
          await progress.flush();
          await sendError(out, err);
        }
      } finally {
        reader.close();
        out.end();
      }
    })();
    return response;
  }

  #history(
    request: Request,
    url: URL,
    machineId: string,
    sessionId: string,
    caller: HistoryCaller,
  ): Response {
    const lastEventId = request.headers.get("last-event-id");
    return this.#stream(request, machineId, sessionId, caller, async (out, reader, progress) => {
      const report = (p: Parameters<ProgressOut["report"]>[0]) => progress.report(p);
      const query = parseHistoryQuery((name) => url.searchParams.get(name) ?? undefined);
      if (query.kind === "fill") {
        const file = query.file;
        const k =
          file === null
            ? null
            : file.agentId !== null
              ? historyFileKey(file.agentId, sessionId, file.index)
              : await this.#cache.ownFileKey(machineId, sessionId, file.index);
        // A file the copy has never been told of is made whole with the rest of the Session.
        if (k !== null) await reader.file(k, report);
        else await reader.fill(report);
        await progress.flush();
        await out.send("filled", null, "{}");
        return;
      }
      const owner = { sessionId, userId: caller.userId, query: JSON.stringify(query) };
      const resume = resumePoint(lastEventId);
      const held = resume !== null ? this.#windows.find(resume.windowId, owner) : null;
      let window = held;
      if (window === null) {
        const assembled = await reader.window(query.read, query.fill, report);
        window = serializeWindow(
          assembled.response,
          (_m, i) => assembled.sources[i] ?? null,
          assembled.serverNowMs,
        );
        this.#windows.hold(window, owner);
        await progress.flush();
      }
      await sendWindow(out, window, held !== null ? resume!.offset : null);
      if (query.fill) {
        await reader.fill(report);
        await progress.flush();
        await out.send("filled", null, "{}");
      }
    });
  }

  #traceBody(
    request: Request,
    url: URL,
    machineId: string,
    sessionId: string,
    caller: HistoryCaller,
  ): Response {
    return this.#stream(request, machineId, sessionId, caller, async (out, reader, progress) => {
      const ref = url.searchParams.get("ref") ?? "";
      const notFound = () =>
        new HttpError(404, "trace_body_not_found", "This conversation holds no such value.");
      // A ref names a line of this Session or of a subagent its windows expanded: nothing else,
      // and a ref that is not one finds nothing either.
      const named = decodeBodyRef(ref);
      if (named === null) throw notFound();
      if (!(await this.#cache.groupSessions(machineId, sessionId)).includes(named.sessionId)) {
        throw notFound();
      }
      const k = historyFileKey(named.agentId, named.sessionId, named.fileIndex);
      const held = await this.#cache.records(machineId, k, named.ordinal, named.ordinal + 1);
      let record = held?.[0]?.record ?? null;
      let fetched: { totalBytes: number } | null = null;
      if (record === null) {
        const body = await reader.body(ref, k, named.ordinal, (p) => progress.report(p));
        fetched = { totalBytes: body.totalBytes };
        record =
          body.record ??
          (await this.#cache.records(machineId, k, named.ordinal, named.ordinal + 1))?.[0]
            ?.record ??
          null;
      }
      const value = record !== null ? bodyAt(record, named.path) : null;
      if (value === null) throw notFound();
      await progress.flush();
      await sendBody(out, ref, value, machineId, fetched);
    });
  }

  async #traceImage(url: URL, machineId: string, sessionId: string): Promise<Response | null> {
    const fileIndex = intParam(url, "file", 1);
    const ordinal = intParam(url, "ordinal", 0);
    const raw = url.searchParams.get("i");
    const slot = raw === null ? undefined : (intParam(url, "i", 0) ?? -1);
    if (fileIndex === null || ordinal === null || slot === -1) return null;
    const k = await this.#cache.ownFileKey(machineId, sessionId, fileIndex);
    if (k === null) return null;
    const held = await this.#cache.records(machineId, k, ordinal, ordinal + 1);
    const image = held?.[0] !== undefined ? traceRecordImage(held[0].record, slot) : null;
    if (image === null) return null;
    return new Response(new Uint8Array(image.bytes), {
      status: 200,
      headers: {
        "content-type": image.mime,
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  }

  async #traceEvents(url: URL, machineId: string, k: HistoryFileKey): Promise<Response | null> {
    const offset = intParam(url, "offset", 0, 0);
    const limit = intParam(url, "limit", 1, 200);
    if (offset === null || limit === null || limit > 1000) return null;
    const total = await this.#cache.finalRecords(machineId, k);
    if (total === null) return null;
    const from = Math.min(offset, total);
    const held = await this.#cache.records(machineId, k, from, Math.min(total, from + limit));
    if (held === null) return null;
    return Response.json({
      events: held.map((entry) => entry.record),
      offset,
      limit,
      total,
    } satisfies TraceEventsResponse);
  }
}
