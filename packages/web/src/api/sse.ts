/**
 * Event streams: a Session's output, the user-level server events, and the machines aggregate.
 *
 * - Records use the default event (no `event:` line); data is the message envelope as
 *   raw JSON;
 * - Server events use `event: server_event` (approval_request / task_state / resync_required /
 *   credentials_updated / hello, and `heartbeat` — the stream's own beat);
 * - The machines aggregate uses `event: machine_event`, data `{machineId, event}` — one
 *   machine's own server event, tagged with the machine it came from.
 * - A history read (`history`, `trace-body`) is a stream too, of named events only — `progress`,
 *   `page`, `records`, `part`, `done`, `filled`, `error` — with acknowledged flow and a 5 s
 *   `ping`. It is a read with an end, so its reader closes it once the read is over: the socket
 *   re-issues any stream the server ends, which here would read the window again.
 * - A stream is a call on the page's one API socket (api/socket.ts, PRFC-0011), which
 *   re-issues it with `last-event-id` after any interruption (the server replays from its
 *   ring buffer; if the event was already evicted, it pushes resync_required instead). There
 *   is no second transport for a stream: without a socket it waits for one, in silence.
 * - Liveness: a connection can die without any error (half-open TCP, a stuck proxy or NAT).
 *   Once a stream has carried its beat (`heartbeat` every 20 s), {@link STREAM_HEARTBEAT_MS}
 *   without any frame of its own ends it and re-issues it from its last event id.
 * Docs: /docs/server-api § "Streaming (SSE)".
 */
import type { AmspRecord } from "@prismshadow/amsp";
import type {
  HistoryPage,
  HistoryProgress,
  HistoryRecords,
  HistoryStreamError,
  MachineEvent,
  ServerEvent,
} from "@prismshadow/penguin-server/api";
import { apiUrl } from "../lib/server-context";
import { machineForSession } from "../lib/session-machines";
import { apiSocket } from "./socket";
import type { StreamOptions } from "./socket";

/**
 * The cadence a stream that carries a beat speaks at: the server writes a `heartbeat` server
 * event every 20 s on `/api/events` and on the machines aggregate (docs § "One event stream per
 * machine"). Two beats of silence on such a stream means the stream — not the socket under it —
 * has stopped answering, and api/socket.ts ends it and re-subscribes it from its last event id.
 * A stream that writes no beat must not ask for the watchdog, or it would be ended every 40 s.
 */
export const STREAM_HEARTBEAT_MS = 20_000;

export interface StreamHandlers {
  /**
   * A single AmspRecord (full/streaming/event, envelope as-is). `eventId` is the SSE
   * event id assigned by the server channel (`<epoch>-<seq>`; null if the event carried
   * none) — stream-controller uses it to align buffered events with the live-tail cursor
   * that GET /messages returns.
   */
  onRecord: (msg: AmspRecord, eventId: string | null) => void;
  /** A single server event (`eventId`: same as onRecord). */
  onServerEvent: (event: ServerEvent, eventId: string | null) => void;
  /**
   * A frame whose `event:` name this module does not dispatch by itself — the machines
   * aggregate's `machine_event` is the one caller today (openMachineEvents below). `data` is
   * the parsed JSON, `eventId` as on the two handlers above. A stream that supplies none keeps
   * reading such a frame as a record, which is what every stream did before named
   * dispatch existed; `heartbeat` never reaches here either way, it is liveness only.
   */
  onEvent?: (name: string, data: unknown, eventId: string | null) => void;
  /** Connection established (including a successful auto-reconnect, and a reopen after silence). */
  onOpen?: () => void;
  /**
   * Connection error. `closed` is true when the stream is over for good — the endpoint
   * answered with a fatal status (401, 403, 404…) — and false when it is being retried,
   * which is this module's own doing: the caller needs no reconnection of its own.
   */
  onError?: (closed: boolean) => void;
}

export interface StreamConnection {
  close: () => void;
}

/**
 * A stream is a call on the page's one API socket, which owns the reconnection and the
 * per-stream heartbeat watchdog: each stream is re-issued from its last event id after any
 * interruption, and traffic on another stream is never read as this one's beat.
 */
function subscribe(
  url: string,
  handlers: StreamHandlers,
  options: StreamOptions = {},
): StreamConnection {
  return apiSocket.stream(url, handlers, options);
}

/** Subscribes to a Session's output stream (GET /api/sessions/:sessionId/stream). */
export function openSessionStream(sessionId: string, handlers: StreamHandlers): StreamConnection {
  // Routed like every other Session call: the stream comes from the machine running it.
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/stream`;
  return subscribe(apiUrl(path, machineForSession(sessionId)), handlers);
}

/**
 * Subscribes to the user-level server event stream (GET /api/events) — this server's, or a
 * machine's through the same-origin proxy. A Session on a machine changes state on THAT
 * machine's server, and only its stream says so; the list is assembled from every connected
 * machine, so its liveness has to be too.
 *
 * Both ends of this stream write the `heartbeat` server event, so it is watched per stream:
 * a machine whose App stopped answering while its socket stayed healthy would otherwise keep
 * a subscription that never speaks again, with nothing to notice it.
 */
export function openUserEvents(
  handlers: StreamHandlers,
  machineId: string | null = null,
): StreamConnection {
  return subscribe(apiUrl("/api/events", machineId), handlers, {
    heartbeatMs: STREAM_HEARTBEAT_MS,
  });
}

/** The machines aggregate's handlers: many machines' events on one stream (openMachineEvents). */
export interface MachineStreamHandlers {
  /** One machine's own event, with the machine it came from and its SSE event id. */
  onMachineEvent: (machineId: string, event: ServerEvent, eventId: string | null) => void;
  /**
   * The hub's own server events on the same stream: `hello` on a fresh subscribe, and
   * `resync_required` when the tab's last event id could not be honoured from the hub's
   * bounded buffer — the one that means application events were missed.
   */
  onHubEvent?: (event: ServerEvent, eventId: string | null) => void;
  onOpen?: () => void;
  onError?: (closed: boolean) => void;
}

/**
 * Subscribes to this Project's machines aggregate
 * (GET /api/projects/:projectId/machines/events): ONE stream for the whole tab whatever the
 * number of connected machines (docs § "One event stream per machine"). Each `machine_event`
 * carries the machine it came from, so a caller routes it the way it routed that machine's own
 * stream; the hub's `server_event` frames are the stream's own news and go to `onHubEvent`.
 * Reconnecting with the tab's last event id replays the hub's buffer, filtered to the machines
 * this Project watches; a machine that is slow to attach does not hold the stream up.
 */
export function openMachineEvents(
  projectId: string,
  handlers: MachineStreamHandlers,
): StreamConnection {
  const path = `/api/projects/${encodeURIComponent(projectId)}/machines/events`;
  const streamHandlers: StreamHandlers = {
    // No unnamed frames on this stream: a machine's `message` would be a record from a
    // Session, which the aggregate does not carry (`machine_event` carries server events only).
    onRecord: () => undefined,
    onServerEvent: (event, eventId) => handlers.onHubEvent?.(event, eventId),
    onEvent: (name, data, eventId) => {
      if (name !== "machine_event") return;
      const frame = data as MachineEvent;
      // Malformed JSON was skipped before this; a frame that is not one of the aggregate's
      // either is dropped rather than routed at an invented machine.
      if (frame === null || typeof frame !== "object" || typeof frame.machineId !== "string") {
        return;
      }
      handlers.onMachineEvent(frame.machineId, frame.event, eventId);
    },
    onOpen: handlers.onOpen,
    onError: handlers.onError,
  };
  return subscribe(path, streamHandlers, { heartbeatMs: STREAM_HEARTBEAT_MS });
}

/**
 * The beat a history stream speaks at: the server writes a `ping` every 5 s while it has nothing
 * else to send (while the machine behind it is slow, or out of reach and being retried). Two
 * silent beats end the stream here and re-issue it from its last event id, which the server
 * continues the same window from.
 */
export const HISTORY_STREAM_BEAT_MS = 5_000;

/**
 * One read of a Session's history over the `history` stream: the newest `limit` Tasks (`tail`,
 * cut at `budget` bytes of records when given, and with `fill` the stream stays open after the
 * window to bring the rest of the Session to the server that serves this page), the Tasks before
 * a cursor (`before`), the whole transcript (`full`), or no window at all — only one Trace file
 * made whole on this page's server (`fill`, the Trace panel's read, of the Agent's file `file`;
 * this server's own Session answers `filled` at once).
 */
export type HistoryStreamQuery =
  | { kind: "tail"; limit: number; budget?: number; fill?: boolean }
  | { kind: "before"; cursor: string; limit: number; budget?: number }
  | { kind: "full" }
  | { kind: "fill"; file: number; agent?: string };

/** What a history or trace-body stream says, event by event. */
export interface HistoryStreamHandlers {
  /** How far the bytes behind the read have come, and whether the machine is being waited for. */
  onProgress?: (progress: HistoryProgress) => void;
  /** A window begins: what it holds beside its records. A new window id replaces any window in part. */
  onPage?: (page: HistoryPage) => void;
  /** Whole record lines (`records`), or a piece of one record longer than a frame (`part`). */
  onRecords?: (frame: HistoryRecords, kind: "records" | "part") => void;
  /** The window (or the body, or a `fill` read) is complete. */
  onDone?: (windowId: string | null) => void;
  /** After a window read with `fill`: the rest of the Session is on this page's server. */
  onFilled?: () => void;
  /**
   * The read is over and failed: the server's `error` event, or the stream refused for good (it
   * answered 401, 403 or 404 — reported as `not_found`). A stream that dropped is not an error:
   * the socket re-issues it from its last event id by itself.
   */
  onError: (error: HistoryStreamError) => void;
}

/**
 * A history or trace-body stream on the page's one socket, with acknowledged flow: the server
 * keeps no more than its window of unacknowledged data in flight, so a long history never holds
 * back the socket's other calls. Event names are dispatched to the handlers; the beat (`ping`)
 * is the socket's own business.
 */
function subscribeHistory(path: string, handlers: HistoryStreamHandlers): StreamConnection {
  return subscribe(
    path,
    {
      // Every event of these streams is named; an unnamed frame would be no record of theirs.
      onRecord: () => undefined,
      onServerEvent: () => undefined,
      onEvent: (name, data) => {
        switch (name) {
          case "progress":
            handlers.onProgress?.(data as HistoryProgress);
            return;
          case "page":
            handlers.onPage?.(data as HistoryPage);
            return;
          case "records":
          case "part":
            handlers.onRecords?.(data as HistoryRecords, name);
            return;
          case "done":
            handlers.onDone?.((data as { windowId?: string } | null)?.windowId ?? null);
            return;
          case "filled":
            handlers.onFilled?.();
            return;
          case "error":
            handlers.onError(data as HistoryStreamError);
            return;
        }
      },
      onError: (closed) => {
        if (closed) handlers.onError({ code: "not_found", message: "the stream was refused" });
      },
    },
    { flow: true, heartbeatMs: HISTORY_STREAM_BEAT_MS },
  );
}

/** The query string of a history read, in the server's grammar (the `/messages` one plus `budget` and `fill`). */
function historyQuery(query: HistoryStreamQuery): string {
  const params = new URLSearchParams();
  switch (query.kind) {
    case "tail":
      params.set("tailLimit", String(query.limit));
      if (query.budget !== undefined) params.set("budget", String(query.budget));
      if (query.fill === true) params.set("fill", "1");
      break;
    case "before":
      params.set("before", query.cursor);
      params.set("limit", String(query.limit));
      if (query.budget !== undefined) params.set("budget", String(query.budget));
      break;
    case "full":
      break;
    case "fill":
      params.set("fill", "only");
      params.set("file", String(query.file));
      if (query.agent !== undefined) params.set("agent", query.agent);
      break;
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/**
 * Reads a Session's history over the `history` stream (GET /api/sessions/:sessionId/history),
 * routed like every other Session call: a Session on a machine is answered by this page's server
 * from what it holds of that machine's Trace, asking the machine only for what it lacks.
 */
export function openHistoryStream(
  sessionId: string,
  query: HistoryStreamQuery,
  handlers: HistoryStreamHandlers,
): StreamConnection {
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/history${historyQuery(query)}`;
  return subscribeHistory(apiUrl(path, machineForSession(sessionId)), handlers);
}

/**
 * Reads the whole of one value a history record carried as a preview (GET
 * /api/sessions/:sessionId/trace-body?ref=): its pieces arrive as `part` events in order, then
 * `done`. `ref` is the history record's own handle for the value, opaque here.
 */
export function openTraceBodyStream(
  sessionId: string,
  ref: string,
  handlers: HistoryStreamHandlers,
): StreamConnection {
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/trace-body?ref=${encodeURIComponent(ref)}`;
  return subscribeHistory(apiUrl(path, machineForSession(sessionId)), handlers);
}
