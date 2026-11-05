/**
 * Server-sent events, read the way an `EventSource` reads them, for a body `fetch` returned (an
 * `EventSource` cannot send an `Authorization` header or a POST body), and sorted into what AMSP
 * makes of each.
 */
import { AmspStreamError } from "./errors.js";
import type { AmspControl, AmspRecord } from "./types.js";

/** One SSE event: its `event:` name (null when it has none), its `id:` (null likewise) and its data. */
export interface SseEvent {
  event: string | null;
  id: string | null;
  data: string;
}

/**
 * What one event of an AMSP stream is:
 * - `record`: an unnamed event, its data one record envelope, with the event's id;
 * - `control`: `ping`;
 * - `done`: `data: [DONE]`, the end of a run stream;
 * - `other`: a named event AMSP does not define. A host may add its own (the Web App's internal
 *   channel carries `server_event`); a reader ignores them.
 */
export type AmspFrame =
  | { kind: "record"; id: string | null; record: AmspRecord }
  | { kind: "control"; control: AmspControl }
  | { kind: "done" }
  | { kind: "other"; name: string; data: string };

/**
 * The events of an SSE body, in order. Each event's `data:` lines are joined with `\n`; `event:`
 * and `id:` are kept; comment lines (`: keep-alive`) and other fields are skipped.
 *
 * Lines may end in LF, CRLF or a lone CR, and a chunk may split a line, a line ending or a UTF-8
 * character anywhere. An event is dispatched at the blank line that closes it; one the body ends
 * in the middle of is dropped, since its data may be cut short, and so is an event with no
 * `data:` line. The body is read to its end, or cancelled — the connection closed — when the
 * caller stops iterating early.
 *
 * Once `signal` aborts, the body is cancelled and the read rejects with the signal's reason,
 * whether or not the `fetch` that produced the body honours the signal itself.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const onAbort = () => {
    reader.cancel(signal!.reason).catch(() => {});
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  // One instance per body: the search position lives on the regex, and this generator yields
  // between searches while another body's reader may run.
  const terminator = /\r\n|\r|\n/g;
  // Text after the last complete line; terminators are searched for from `from` on.
  let pending = "";
  let from = 0;
  // The current event's fields; data is null until the event has a data line.
  let data: string[] | null = null;
  let name: string | null = null;
  let id: string | null = null;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        throw signal?.aborted ? signal.reason : err;
      }
      if (signal?.aborted) throw signal.reason;
      const done = chunk.done;
      pending += done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });

      const lines: string[] = [];
      let start = 0;
      let waitForLf = false;
      terminator.lastIndex = from;
      for (let match = terminator.exec(pending); match; match = terminator.exec(pending)) {
        // A CR that ends what has arrived may be the first half of a CRLF.
        if (!done && match[0] === "\r" && match.index === pending.length - 1) {
          waitForLf = true;
          break;
        }
        lines.push(pending.slice(start, match.index));
        start = match.index + match[0].length;
      }
      pending = pending.slice(start);
      from = waitForLf ? pending.length - 1 : pending.length;

      for (const line of lines) {
        if (line === "") {
          if (data !== null) {
            const event: SseEvent = { event: name, id, data: data.join("\n") };
            data = null;
            name = null;
            id = null;
            yield event;
            // The caller can abort while the generator is suspended, even when the
            // next event (or [DONE]) has already arrived in this chunk.
            if (signal?.aborted) throw signal.reason;
          } else {
            name = null;
            id = null;
          }
          continue;
        }
        const colon = line.indexOf(":");
        // A comment has an empty field name and falls out with every unknown field.
        const field = colon === -1 ? line : line.slice(0, colon);
        const raw = colon === -1 ? "" : line.slice(colon + 1);
        const value = raw.startsWith(" ") ? raw.slice(1) : raw;
        if (field === "data") (data ??= []).push(value);
        else if (field === "event") name = value === "" ? null : value;
        else if (field === "id") id = value;
      }
      if (done) return;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Closes the connection when the caller stopped early or the read failed; a no-op at the end.
    await reader.cancel().catch(() => {});
  }
}

const CONTROL_KINDS = new Set(["ping"]);

/** Parses an event's data as JSON; anything that is not breaks the stream. */
function json(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch (err) {
    throw new AmspStreamError(`The stream carried data that is not JSON: ${data.slice(0, 200)}`, {
      cause: err,
    });
  }
}

/**
 * What an SSE event is to AMSP (see {@link AmspFrame}). An unnamed event whose data is not an
 * envelope — not JSON, or no outer `type` — is an {@link AmspStreamError}: the stream is not
 * AMSP's. A control frame's data is ignored.
 */
export function frameOf(ev: SseEvent): AmspFrame {
  if (ev.event === null || ev.event === "message") {
    if (ev.data === "[DONE]") return { kind: "done" };
    const value = json(ev.data);
    if (
      value === null ||
      typeof value !== "object" ||
      typeof (value as { type?: unknown }).type !== "string"
    ) {
      throw new AmspStreamError(
        `The stream carried a record that is not an envelope: ${ev.data.slice(0, 200)}`,
      );
    }
    return { kind: "record", id: ev.id, record: value as AmspRecord };
  }
  if (CONTROL_KINDS.has(ev.event)) {
    return { kind: "control", control: { kind: ev.event as AmspControl["kind"] } };
  }
  return { kind: "other", name: ev.event, data: ev.data };
}

/** The frames of an AMSP body, in order: {@link readSse} sorted by {@link frameOf}. */
export async function* readAmsp(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<AmspFrame> {
  for await (const ev of readSse(body, signal)) yield frameOf(ev);
}
