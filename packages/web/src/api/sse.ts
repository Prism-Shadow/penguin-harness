/**
 * Event streams: a Session's output, the user-level server events, and the machines aggregate.
 *
 * - OmniMessage uses the default event (no `event:` line); data is the message envelope as
 *   raw JSON;
 * - Server events use `event: server_event` (approval_request / task_state / resync_required /
 *   credentials_updated / hello, and `heartbeat` — the stream's own beat);
 * - The machines aggregate uses `event: machine_event`, data `{machineId, event}` — one
 *   machine's own server event, tagged with the machine it came from.
 * - A stream is a call on the page's one API socket (api/socket.ts, PRFC-0011), which
 *   re-issues it with `last-event-id` after any interruption (the server replays from its
 *   ring buffer; if the event was already evicted, it pushes resync_required instead). When
 *   the socket is not to be had, the same stream is an EventSource: the browser then
 *   auto-reconnects with the same header, and auth rides the same-origin cookie either way.
 * - Liveness: a connection can die without any error (half-open TCP, a stuck proxy or NAT).
 *   Once a stream has sent a `ping` (the server's heartbeat, every 20 s), {@link SILENCE_MS}
 *   without any event closes it and opens a new one with `?lastEventId=` set to the last id
 *   seen; the tab becoming visible checks at once, since background timers run late. A stream
 *   that never pinged (an older server), or that the browser gave up on, is left as it is.
 * Docs: /docs/server-api § "Streaming (SSE)".
 */
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
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

/** The server pings every 20 s: this much silence means the connection is gone. */
const SILENCE_MS = 50_000;

export interface StreamHandlers {
  /**
   * A single OmniMessage (full/streaming/event, envelope as-is). `eventId` is the SSE
   * event id assigned by the server channel (`<epoch>-<seq>`; null if the event carried
   * none) — stream-controller uses it to align buffered events with the live-tail cursor
   * that GET /messages returns.
   */
  onOmniMessage: (msg: OmniMessage, eventId: string | null) => void;
  /** A single server event (`eventId`: same as onOmniMessage). */
  onServerEvent: (event: ServerEvent, eventId: string | null) => void;
  /**
   * A frame whose `event:` name this module does not dispatch by itself — the machines
   * aggregate's `machine_event` is the one caller today (openMachineEvents below). `data` is
   * the parsed JSON, `eventId` as on the two handlers above. A stream that supplies none keeps
   * reading such a frame as an OmniMessage, which is what every stream did before named
   * dispatch existed; `heartbeat` never reaches here either way, it is liveness only.
   */
  onEvent?: (name: string, data: unknown, eventId: string | null) => void;
  /** Connection established (including a successful auto-reconnect, and a reopen after silence). */
  onOpen?: () => void;
  /**
   * Connection error. `closed` is true when the browser has deemed the connection fatally
   * broken and closed it (e.g. the handshake returned 401/403, so it won't auto-reconnect);
   * when false, the browser will auto-reconnect and no manual handling is needed.
   */
  onError?: (closed: boolean) => void;
}

export interface StreamConnection {
  close: () => void;
}

/**
 * A stream is a call on the page's one API socket; when the socket is not to be had, the same
 * stream runs as an EventSource instead — the browser's own reconnect carries a last event id
 * forward, and auth rides the same-origin cookie either way.
 *
 * The socket's heartbeat watchdog and EventSource's named-ping watchdog each reopen their own
 * stream from its last event id; neither treats traffic on another stream as this one's beat.
 */
function subscribe(
  url: string,
  handlers: StreamHandlers,
  options: StreamOptions = {},
): StreamConnection {
  return apiSocket.stream(url, handlers, () => subscribeEventSource(url, handlers), options);
}

/** The EventSource fallback retains its heartbeat watchdog. */
function subscribeEventSource(url: string, handlers: StreamHandlers): StreamConnection {
  let source: EventSource | undefined;
  /** The newest event id seen on any of this subscription's connections. */
  let lastEventId = "";
  let lastHeard = 0;
  /** The stream has pinged, so silence means a dead connection. */
  let armed = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  const heard = (e: MessageEvent<string>) => {
    lastHeard = Date.now();
    if (e.lastEventId) lastEventId = e.lastEventId;
  };
  const onMessage = (e: MessageEvent<string>) => {
    heard(e);
    try {
      // Every server event carries an `id:` line; lastEventId is "" only if none did.
      handlers.onOmniMessage(JSON.parse(e.data) as OmniMessage, e.lastEventId || null);
    } catch {
      // Ignore lines that fail to parse (the protocol guarantees single-line JSON data, so this shouldn't normally happen).
    }
  };
  const onServerEvent = (e: MessageEvent<string>) => {
    heard(e);
    try {
      // On the aggregate this is the hub's own frame (`hello` / `resync_required`), which the
      // aggregate's onServerEvent adapter routes to onHubEvent; on every other stream it is a
      // server event like any other.
      const event = JSON.parse(e.data) as ServerEvent;
      if (event.type === "heartbeat") return;
      handlers.onServerEvent(event, e.lastEventId || null);
    } catch {
      // Same as above.
    }
  };
  const onPing = (e: MessageEvent<string>) => {
    heard(e);
    armed = true;
    check();
  };
  const onError = () => {
    const closed = source?.readyState === EventSource.CLOSED;
    // The browser gave up on the connection: what happens next is the caller's call, as before.
    if (closed) disarm();
    handlers.onError?.(closed);
  };
  const connect = () => {
    source?.close();
    lastHeard = Date.now();
    source = new EventSource(
      lastEventId ? `${url}?lastEventId=${encodeURIComponent(lastEventId)}` : url,
    );
    source.onmessage = onMessage;
    source.addEventListener("server_event", onServerEvent);
    source.addEventListener("ping", onPing);
    source.addEventListener("machine_event", (e: MessageEvent<string>) => {
      heard(e);
      try {
        handlers.onEvent?.(
          "machine_event",
          JSON.parse(e.data) as MachineEvent,
          e.lastEventId || null,
        );
      } catch {
        // Ignore malformed frames, as for other event names.
      }
    });
    if (handlers.onOpen) source.onopen = handlers.onOpen;
    source.onerror = onError;
  };

  /** Reopens a stream silent for the whole window; otherwise waits out the rest of it. */
  const check = () => {
    clearTimeout(watchdog);
    if (!armed) return;
    if (Date.now() - lastHeard >= SILENCE_MS) connect();
    watchdog = setTimeout(check, lastHeard + SILENCE_MS - Date.now());
  };
  const disarm = () => {
    armed = false;
    clearTimeout(watchdog);
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") check();
  };

  document.addEventListener("visibilitychange", onVisibility);
  connect();
  return {
    close: () => {
      disarm();
      document.removeEventListener("visibilitychange", onVisibility);
      source?.close();
    },
  };
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
    // No unnamed frames on this stream: a machine's `message` would be an OmniMessage from a
    // Session, which the aggregate does not carry (`machine_event` carries server events only).
    onOmniMessage: () => undefined,
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
