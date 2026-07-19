/**
 * SSE (EventSource) wrapper.
 *
 * - OmniMessage uses the default event (no `event:` line); data is the message envelope as
 *   raw JSON;
 * - Server events use `event: server_event` (approval_request / task_state / resync_required / hello);
 * - EventSource can't set custom request headers, so auth relies on same-origin cookies; on
 *   disconnect, the browser auto-reconnects and attaches a `Last-Event-ID` header (the server
 *   replays from its ring buffer; if the event was already evicted, it pushes resync_required
 *   instead).
 * Docs: /docs/server-api § "Streaming (SSE)".
 */
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import type { ServerEvent } from "@prismshadow/penguin-server/api";

export interface StreamHandlers {
  /** A single OmniMessage (full/streaming/event, envelope as-is). */
  onOmniMessage: (msg: OmniMessage) => void;
  /** A single server event. */
  onServerEvent: (event: ServerEvent) => void;
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
      handlers.onOmniMessage(JSON.parse(e.data) as OmniMessage);
    } catch {
      // Ignore lines that fail to parse (the protocol guarantees single-line JSON data, so this shouldn't normally happen).
    }
  };
  source.addEventListener("server_event", (e: MessageEvent<string>) => {
    try {
      handlers.onServerEvent(JSON.parse(e.data) as ServerEvent);
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
  return subscribe(`/api/sessions/${encodeURIComponent(sessionId)}/stream`, handlers);
}

/** Subscribes to the user-level server event stream (GET /api/events; reserved for scheduled-task notifications). */
export function openUserEvents(handlers: StreamHandlers): StreamConnection {
  return subscribe("/api/events", handlers);
}
