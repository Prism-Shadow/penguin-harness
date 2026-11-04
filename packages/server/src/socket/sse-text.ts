/**
 * The text/event-stream wire format, as this server writes it.
 *
 * Where a stream can cross as the events it already are, it does: the socket transport
 * answers them directly (socket/stream-answer.ts), and hono's own `writeSSE` writes the
 * Session and user channels (http/sse.ts). This is the writer for the two faces that build a
 * Response by hand — the machine aggregate and the socket relay (machines/) — whose HTTP
 * readers still get text.
 *
 * Only the fields this server's own SSE protocol uses are modelled: `id`, `event`, `data`.
 * `data` is a single line in this server's protocol (single-line JSON); the writer splits a
 * multi-line payload as the spec says, so a foreign payload would still come out well-formed.
 */

export interface SseEvent {
  /** The `id:` line, or null when the event carried none. */
  id: string | null;
  /** The `event:` line; "message" when absent (the browser's EventSource default). */
  event: string;
  /** The joined `data:` lines. */
  data: string;
}

/** One event in wire form, terminated by its blank line. */
export function formatSseEvent(event: SseEvent): string {
  let text = "";
  if (event.id !== null) text += `id: ${event.id}\n`;
  if (event.event !== "message") text += `event: ${event.event}\n`;
  for (const line of event.data.split("\n")) text += `data: ${line}\n`;
  return `${text}\n`;
}
