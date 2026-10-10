/**
 * SSE (EventSource) wrapper.
 *
 * - OmniMessage uses the default event (no `event:` line); data is the message envelope as
 *   raw JSON;
 * - Server events use `event: server_event` (approval_request / task_state / resync_required /
 *   credentials_updated / hello);
 * - EventSource can't set custom request headers, so auth relies on same-origin cookies; on
 *   disconnect, the browser auto-reconnects and attaches a `Last-Event-ID` header (the server
 *   replays from its ring buffer; if the event was already evicted, it pushes resync_required
 *   instead).
 *
 * Liveness. A connection can die without the browser ever noticing: a half-open TCP
 * connection, a stuck proxy or NAT, a laptop that slept or changed networks. No error fires,
 * and a page that only listens freezes until it is reloaded. The server sends a named `ping`
 * event when a stream opens and every 20 s after (server http/sse.ts), so a stream that has
 * pinged once is expected to keep making noise:
 *
 * - The watchdog: silence for {@link SILENCE_MS} (2.5 heartbeats) closes the EventSource and
 *   opens a new one with `?lastEventId=<last id seen>`, which the server replays from — or
 *   answers with `resync_required` when that id has left its buffer, which the callers
 *   already handle. Becoming visible and coming back online check at once, because a
 *   background tab's or a sleeping laptop's timers run late or not at all.
 * - A stream that has pinged is also reopened when the browser gives up on it (a 502 from a
 *   proxy while the server restarts, say), after the same backoff.
 * - Retries back off exponentially ({@link RETRY_BASE_MS} doubling to {@link RETRY_MAX_MS})
 *   while attempts keep failing; anything heard from the server resets it.
 * - A stream that has never pinged — a server older than this protocol, such as a machine
 *   not upgraded yet — is left exactly as the browser runs it: no watchdog, no reopening.
 *   Reopening it would cost the replay too, since such a server ignores the query id.
 *
 * At most one EventSource is open per subscription at any time.
 * Docs: /docs/server-api § "Streaming (SSE)".
 */
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import { apiUrl } from "../lib/server-context";
import { machineForSession } from "../lib/session-machines";

/** The server pings every 20 s; this much silence means the connection is gone. */
const SILENCE_MS = 50_000;
/** The first retry after a failed reopen waits this long, doubling each time it fails again. */
const RETRY_BASE_MS = 1_000;
/** The longest a retry ever waits. */
const RETRY_MAX_MS = 30_000;

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
  /** Connection established (including an auto-reconnect, and a reopen after silence). */
  onOpen?: () => void;
  /**
   * Connection error. `closed` is true when the browser has deemed the connection fatally
   * broken and closed it (e.g. the handshake returned 401/403/502) and will not reconnect on
   * its own; a stream that has pinged is then reopened by this wrapper after a backoff. When
   * false, the browser reconnects by itself and no manual handling is needed.
   */
  onError?: (closed: boolean) => void;
}

export interface StreamConnection {
  close: () => void;
}

/** `url` with the replay position the server reads when no `Last-Event-ID` header comes. */
function withLastEventId(url: string, id: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}lastEventId=${encodeURIComponent(id)}`;
}

function subscribe(url: string, handlers: StreamHandlers): StreamConnection {
  let source: EventSource | null = null;
  /** The newest event id seen on any connection of this subscription. */
  let lastEventId: string | null = null;
  /** The server has pinged: silence now means a dead connection. Never reset. */
  let pings = false;
  let lastHeard = Date.now();
  /** Reopens since the server was last heard from; sets the backoff. */
  let failures = 0;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const heard = () => {
    lastHeard = Date.now();
    failures = 0;
  };
  const seen = (e: MessageEvent<string>) => {
    heard();
    if (e.lastEventId) lastEventId = e.lastEventId;
  };

  const armWatchdog = () => {
    if (stopped || !pings || watchdog !== null) return;
    watchdog = setTimeout(
      () => {
        watchdog = null;
        check();
      },
      Math.max(0, lastHeard + SILENCE_MS - Date.now()),
    );
  };

  /** Reopens when the stream has been silent past the window; otherwise re-arms for the rest of it. */
  const check = () => {
    if (stopped || !pings || retry !== null) return;
    if (Date.now() - lastHeard >= SILENCE_MS) reopen();
    else armWatchdog();
  };

  const connect = () => {
    retry = null;
    const es = new EventSource(lastEventId === null ? url : withLastEventId(url, lastEventId));
    source = es;
    // A new attempt gets a whole window to be heard from.
    lastHeard = Date.now();
    es.onmessage = (e: MessageEvent<string>) => {
      seen(e);
      try {
        // Every server event carries an `id:` line; lastEventId is "" only if none did.
        handlers.onOmniMessage(JSON.parse(e.data) as OmniMessage, e.lastEventId || null);
      } catch {
        // Ignore lines that fail to parse (the protocol guarantees single-line JSON data, so this shouldn't normally happen).
      }
    };
    es.addEventListener("server_event", (e: MessageEvent<string>) => {
      seen(e);
      try {
        handlers.onServerEvent(JSON.parse(e.data) as ServerEvent, e.lastEventId || null);
      } catch {
        // Same as above.
      }
    });
    es.addEventListener("ping", () => {
      pings = true;
      heard();
      armWatchdog();
    });
    es.onopen = () => handlers.onOpen?.();
    es.onerror = () => {
      const closed = es.readyState === EventSource.CLOSED;
      handlers.onError?.(closed);
      if (closed && pings && source === es && !stopped) reopen();
    };
    armWatchdog();
  };

  /** Replaces the current EventSource: at once the first time, after a growing backoff while reopens keep failing. */
  const reopen = () => {
    source?.close();
    source = null;
    const delay = failures === 0 ? 0 : Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS);
    failures += 1;
    if (delay === 0) connect();
    else retry = setTimeout(connect, delay);
  };

  /** The tab is shown again or the network is back: a late timer must not keep a dead stream. */
  const wake = () => {
    if (stopped || !pings) return;
    if (retry !== null) {
      clearTimeout(retry);
      connect();
      return;
    }
    check();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") wake();
  };
  const hasPage = typeof document !== "undefined" && typeof window !== "undefined";
  if (hasPage) {
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", wake);
  }

  connect();
  return {
    close: () => {
      stopped = true;
      if (watchdog !== null) clearTimeout(watchdog);
      if (retry !== null) clearTimeout(retry);
      watchdog = null;
      retry = null;
      source?.close();
      source = null;
      if (hasPage) {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("online", wake);
      }
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
 */
export function openUserEvents(
  handlers: StreamHandlers,
  machineId: string | null = null,
): StreamConnection {
  return subscribe(apiUrl("/api/events", machineId), handlers);
}
