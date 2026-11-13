/**
 * readSse and readAmsp: the SSE framing of an AMSP body, and what each event is to AMSP, as the
 * SDK and the server's wire tests read them.
 *
 * - Given a body with comments, unknown fields, a field without a colon and a multi-line data
 *   block, each event comes out once with its name and id, its data lines joined with `\n`.
 * - Given the same body with CRLF or lone-CR line endings, delivered whole or a byte at a time
 *   (splitting line endings and UTF-8 characters), the events read the same.
 * - Given a body that ends inside an event, that event is not dispatched.
 * - Given a body that errors (a dropped connection), the read rejects with that error after the
 *   events that arrived.
 * - Given a caller that stops after the first event, the body is cancelled: the connection
 *   closes rather than being read on.
 * - Given an abort between events in one chunk, no buffered event is delivered afterwards.
 * - Given an abort after an event flushed at EOF, the next read rejects instead of completing.
 * - Given an abort before a buffered [DONE], the HTTP transport rejects with the abort reason
 *   rather than reporting a successful end.
 * - Given an AMSP body, an unnamed event is a record with its id, `ping` is a control frame,
 *   `[DONE]` is the end, any other name is a host's own event, and an unnamed event that is not
 *   an envelope breaks the stream.
 */
import { describe, expect, it } from "vitest";
import { AmspStreamError, HttpTransport, readAmsp, readSse } from "../src/index.js";
import type { AmspFrame, SseEvent } from "../src/index.js";
import { BASE_URL, createFetchFake, DONE, frame, never } from "./helpers/fetch-fake.js";
import { taskBegin } from "./helpers/streams.js";

const encoder = new TextEncoder();

/** A body that delivers `text` in chunks of `size` bytes (the whole text when `size` is 0). */
function body(text: string, size = 0): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(text);
  const step = size || bytes.length;
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + step));
      offset += step;
    },
  });
}

async function read(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const ev of readSse(stream)) out.push(ev);
  return out;
}

const data = (events: SseEvent[]) => events.map((e) => e.data);

const STREAM = [
  ": keep-alive",
  "",
  'data: {"type":"text.done","text":"Grüße 🐧"}',
  "",
  "event: ignored",
  "id: 7",
  "retry: 1000",
  "data:first line",
  "data: second line",
  "data",
  "",
  ": keep-alive",
  "",
  "data: [DONE]",
  "",
  "",
].join("\n");

const EVENTS: SseEvent[] = [
  { event: null, id: null, data: '{"type":"text.done","text":"Grüße 🐧"}' },
  { event: "ignored", id: "7", data: "first line\nsecond line\n" },
  { event: null, id: null, data: "[DONE]" },
];

describe("readSse", () => {
  it("yields each event once with its name and id, skipping comments and other fields", async () => {
    expect(await read(body(STREAM))).toEqual(EVENTS);
  });

  it.each([
    { endings: "LF", ending: "\n", size: 1, how: "a byte at a time" },
    { endings: "CRLF", ending: "\r\n", size: 0, how: "whole" },
    { endings: "CRLF", ending: "\r\n", size: 1, how: "a byte at a time" },
    { endings: "CRLF", ending: "\r\n", size: 3, how: "three bytes at a time" },
    { endings: "lone-CR", ending: "\r", size: 0, how: "whole" },
    { endings: "lone-CR", ending: "\r", size: 1, how: "a byte at a time" },
  ])("reads $endings line endings delivered $how the same", async ({ ending, size }) => {
    expect(await read(body(STREAM.replaceAll("\n", ending), size))).toEqual(EVENTS);
  });

  it("drops an event the body ends inside", async () => {
    expect(data(await read(body('data: {"a":1}\n\ndata: {"b":2}\n')))).toEqual(['{"a":1}']);
    expect(data(await read(body('data: {"a":1}\n\ndata: {"b":')))).toEqual(['{"a":1}']);
  });

  it("rejects an abort between events without delivering the rest of the chunk", async () => {
    const control = new AbortController();
    const reason = new Error("Stopped by the caller");
    const events = readSse(body("data: first\n\ndata: second\n\n"), control.signal);
    try {
      expect((await events.next()).value?.data).toBe("first");
      control.abort(reason);
      await expect(events.next()).rejects.toBe(reason);
    } finally {
      await events.return(undefined);
    }
  });

  it("rejects an abort after an event flushed at EOF instead of completing", async () => {
    const control = new AbortController();
    const reason = new Error("Stopped at EOF");
    // The last CR is held until EOF, in case an LF follows in another chunk.
    const events = readSse(body("data: final\r\r"), control.signal);
    try {
      expect((await events.next()).value?.data).toBe("final");
      control.abort(reason);
      await expect(events.next()).rejects.toBe(reason);
    } finally {
      await events.return(undefined);
    }
  });

  it("rejects with the body's error after the events that arrived", async () => {
    const dropped = new TypeError("terminated");
    let sent = false;
    const breaking = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return controller.error(dropped);
        sent = true;
        controller.enqueue(encoder.encode("data: first\n\n"));
      },
    });
    const seen: string[] = [];

    await expect(
      (async () => {
        for await (const ev of readSse(breaking)) seen.push(ev.data);
      })(),
    ).rejects.toBe(dropped);
    expect(seen).toEqual(["first"]);
  });

  it("cancels the body when the caller stops after the first event", async () => {
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode("data: tick\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const ev of readSse(endless)) {
      expect(ev.data).toBe("tick");
      break;
    }
    expect(cancelled).toBe(true);
  });
});

describe("HTTP stream cancellation", () => {
  it("rejects an abort before a buffered DONE instead of reporting success", async () => {
    const fake = createFetchFake();
    const record = taskBegin();
    const served = fake.stream("GET", "/stream", [frame(record, "e-1") + DONE, never()]);
    const transport = new HttpTransport({ baseUrl: BASE_URL, fetch: fake.fetch });
    const control = new AbortController();
    const reason = new Error("Stopped before DONE");
    const seen: unknown[] = [];

    await expect(
      transport.stream("/stream", {
        signal: control.signal,
        onRecord: (_id, value) => {
          seen.push(value);
          control.abort(reason);
        },
        onControl: () => {},
      }),
    ).rejects.toBe(reason);
    expect(seen).toEqual([record]);
    expect(served.closed).toBe(true);
  });
});

describe("readAmsp", () => {
  async function frames(text: string): Promise<AmspFrame[]> {
    const out: AmspFrame[] = [];
    for await (const f of readAmsp(body(text))) out.push(f);
    return out;
  }
  const record = { timestamp: "t", type: "event_msg", payload: { type: "task_begin" } };

  it("sorts records, control frames, the end and a host's own events", async () => {
    const text = [
      "event: ping\ndata: {}\n\n",
      `id: e-1\ndata: ${JSON.stringify(record)}\n\n`,
      'event: server_event\nid: e-2\ndata: {"type":"task_state"}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    expect(await frames(text)).toEqual([
      { kind: "control", control: { kind: "ping" } },
      { kind: "record", id: "e-1", record },
      { kind: "other", name: "server_event", data: '{"type":"task_state"}' },
      { kind: "done" },
    ]);
  });

  it.each(["data: not json\n\n", 'data: {"no":"type"}\n\n'])(
    "breaks the stream on a record that is not an envelope: %j",
    async (text) => {
      await expect(frames(text)).rejects.toBeInstanceOf(AmspStreamError);
    },
  );
});
