/**
 * Event streams: a Session's output, the user-level server events, and the machines aggregate.
 *
 * - Records use the default event (no `event:` line); data is the message envelope as
 *   raw JSON;
 * - Server events use `event: server_event` (approval_request / task_state / resync_required /
 *   credentials_updated / hello, and `heartbeat` — the stream's own beat);
 * - The machines aggregate uses `event: machine_event`, data `{machineId, event}` — one
 *   machine's own server event, tagged with the machine it came from.
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
import type { MachineEvent, ServerEvent } from "@prismshadow/penguin-server/api";
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
