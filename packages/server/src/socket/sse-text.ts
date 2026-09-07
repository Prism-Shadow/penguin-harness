/**
 * The text/event-stream wire format, both ways.
 *
 * The socket transport (socket/ws.ts) re-frames a platform endpoint's SSE Response as JSON
 * frames, and the machine relay (machines/socket-relay.ts) turns a machine's frames back into
 * an SSE Response for the proxy to return — so one endpoint's stream crosses the wire in
 * whichever encoding the hop wants, and neither hop needs to know what the events mean.
 *
 * Only the fields this server's own SSE writer emits are modelled: `id`, `event`, `data`, and
 * comment lines (the heartbeat), which are dropped — the socket has its own ping. `retry` is
 * never emitted and is ignored if seen. `data` is a single line in this server's protocol
 * (single-line JSON), but multi-line data joins with "\n" as the spec says, so a foreign
 * writer would still parse.
 */

export interface SseEvent {
  /** The `id:` line, or null when the event carried none. */
  id: string | null;
  /** The `event:` line; "message" when absent (the browser's EventSource default). */
  event: string;
  /** The joined `data:` lines. */
  data: string;
}

/**
 * Incremental parser: feed chunks in any split, collect events as they complete. A trailing
 * partial line is held until the next chunk; `flush()` at end-of-stream dispatches an event
 * whose terminating blank line never came (a stream that was cut mid-event).
 */
export class SseParser {
  #pending = "";
  #id: string | null = null;
  #event: string | null = null;
  #data: string[] = [];

  feed(chunk: string): SseEvent[] {
    const out: SseEvent[] = [];
    this.#pending += chunk;
    for (;;) {
      const nl = this.#pending.indexOf("\n");
      if (nl === -1) break;
      let line = this.#pending.slice(0, nl);
      this.#pending = this.#pending.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const event = this.#line(line);
      if (event !== null) out.push(event);
    }
    return out;
  }

  flush(): SseEvent | null {
    if (this.#pending !== "") {
      const line = this.#pending;
      this.#pending = "";
      const event = this.#line(line);
      if (event !== null) return event;
    }
    return this.#dispatch();
  }

  #line(line: string): SseEvent | null {
    if (line === "") return this.#dispatch();
    if (line.startsWith(":")) return null; // comment (heartbeat)
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "id":
        this.#id = value;
        break;
      case "event":
        this.#event = value;
        break;
      case "data":
        this.#data.push(value);
        break;
      default:
        break; // retry and unknown fields: ignored
    }
    return null;
  }

  #dispatch(): SseEvent | null {
    if (this.#data.length === 0 && this.#event === null && this.#id === null) return null;
    const event: SseEvent = {
      id: this.#id,
      event: this.#event ?? "message",
      data: this.#data.join("\n"),
    };
    this.#id = null;
    this.#event = null;
    this.#data = [];
    return event;
  }
}

/** One event in wire form, terminated by its blank line. */
export function formatSseEvent(event: SseEvent): string {
  let text = "";
  if (event.id !== null) text += `id: ${event.id}\n`;
  if (event.event !== "message") text += `event: ${event.event}\n`;
  for (const line of event.data.split("\n")) text += `data: ${line}\n`;
  return `${text}\n`;
}
