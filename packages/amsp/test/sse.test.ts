/**
 * readSse: the SSE framing of an AMSP body, as the SDK and the server's wire tests read it.
 *
 * - Given a body with keep-alive comments, fields other than `data`, a field without a colon and
 *   a multi-line data block, each event's data comes out once, its lines joined with `\n`.
 * - Given the same body with CRLF or lone-CR line endings, delivered whole or a byte at a time
 *   (splitting line endings and UTF-8 characters), the events read the same.
 * - Given a body that ends inside an event, that event is not dispatched.
 * - Given a body that errors (a dropped connection), the read rejects with that error after the
 *   events that arrived.
 * - Given a caller that stops after the first event, the body is cancelled: the connection
 *   closes rather than being read on.
 */
import { describe, expect, it } from "vitest";
import { readSse } from "../src/index.js";

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

async function read(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const data of readSse(stream)) out.push(data);
  return out;
}

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

const EVENTS = ['{"type":"text.done","text":"Grüße 🐧"}', "first line\nsecond line\n", "[DONE]"];

describe("readSse", () => {
  it("yields each event's data once, skipping comments and every other field", async () => {
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
    expect(await read(body('data: {"a":1}\n\ndata: {"b":2}\n'))).toEqual(['{"a":1}']);
    expect(await read(body('data: {"a":1}\n\ndata: {"b":'))).toEqual(['{"a":1}']);
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
        for await (const data of readSse(breaking)) seen.push(data);
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
    for await (const data of readSse(endless)) {
      expect(data).toBe("tick");
      break;
    }
    expect(cancelled).toBe(true);
  });
});
