/**
 * The text/event-stream reader a test needs: what this server's SSE writer emits, parsed back
 * to events (src/socket/sse-text.ts writes them). The socket answers events directly now
 * (src/socket/stream-answer.ts) rather than reading this wire format on the way to its
 * frames, so the parser lives here, with the fixtures that read SSE text — an HTTP consumer
 * still gets the text.
 */
import type { SseEvent } from "../../src/socket/sse-text.js";

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
