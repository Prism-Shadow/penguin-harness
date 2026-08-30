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
 * Docs: /docs/server-api § "Streaming (SSE)".
 */
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import { apiUrl } from "../lib/server-context";
import { machineForSession } from "../lib/session-machines";

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
  /** Connection established (including a successful auto-reconnect). */
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

function subscribe(url: string, handlers: StreamHandlers): StreamConnection {
  const source = new EventSource(url);
  source.onmessage = (e: MessageEvent<string>) => {
    try {
      // Every server event carries an `id:` line; lastEventId is "" only if none did.
      handlers.onOmniMessage(JSON.parse(e.data) as OmniMessage, e.lastEventId || null);
    } catch {
      // Ignore lines that fail to parse (the protocol guarantees single-line JSON data, so this shouldn't normally happen).
    }
  };
  source.addEventListener("server_event", (e: MessageEvent<string>) => {
    try {
      handlers.onServerEvent(JSON.parse(e.data) as ServerEvent, e.lastEventId || null);
    } catch {
      // Same as above.
    }
  });
  if (handlers.onOpen) source.onopen = handlers.onOpen;
  const { onError } = handlers;
  if (onError) source.onerror = () => onError(source.readyState === EventSource.CLOSED);
  return { close: () => source.close() };
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
 * machine's server, and only its stream says so; the list is assembled from every reachable
 * machine, so its liveness has to be too.
 */
export function openUserEvents(
  handlers: StreamHandlers,
  machineId: string | null = null,
): StreamConnection {
  return subscribe(apiUrl("/api/events", machineId), handlers);
}
