/**
 * The text/event-stream codec (socket/sse-text.ts): what this server's SSE writer emits parses
 * back to the same events whatever the chunking, comments vanish, and formatting round-trips.
 */
import { describe, expect, it } from "vitest";
import { SseParser, formatSseEvent } from "../src/socket/sse-text.js";

describe("SseParser", () => {
  it("parses id / event / data and dispatches on the blank line", () => {
    const p = new SseParser();
    const events = p.feed('id: 3-7\nevent: server_event\ndata: {"type":"hello"}\n\n');
    expect(events).toEqual([{ id: "3-7", event: "server_event", data: '{"type":"hello"}' }]);
  });

  it("defaults the event name to message and the id to null", () => {
    const p = new SseParser();
    expect(p.feed("data: {}\n\n")).toEqual([{ id: null, event: "message", data: "{}" }]);
  });

  it("is chunking-agnostic: a frame split anywhere yields the same events", () => {
    const wire = 'id: 1\ndata: {"a":1}\n\nid: 2\nevent: server_event\ndata: {"b":2}\n\n';
    const whole = new SseParser().feed(wire);
    for (const cut of [1, 5, 12, 20, 31]) {
      const p = new SseParser();
      const got = [...p.feed(wire.slice(0, cut)), ...p.feed(wire.slice(cut))];
      expect(got, `cut at ${cut}`).toEqual(whole);
    }
  });

  it("drops comment lines — the SSE heartbeat is not an event", () => {
    const p = new SseParser();
    expect(p.feed(": ping\n\n")).toEqual([]);
    expect(p.feed(": ping\ndata: x\n\n")).toEqual([{ id: null, event: "message", data: "x" }]);
  });

  it("joins multi-line data with newlines and tolerates CRLF", () => {
    const p = new SseParser();
    expect(p.feed("data: a\r\ndata: b\r\n\r\n")).toEqual([
      { id: null, event: "message", data: "a\nb" },
    ]);
  });

  it("flushes an event whose terminating blank line never came", () => {
    const p = new SseParser();
    expect(p.feed("id: 9\ndata: tail")).toEqual([]);
    expect(p.flush()).toEqual({ id: "9", event: "message", data: "tail" });
    expect(p.flush()).toBeNull();
  });
});

describe("formatSseEvent", () => {
  it("round-trips through the parser", () => {
    const event = { id: "5-1", event: "server_event", data: '{"type":"task_state"}' };
    expect(new SseParser().feed(formatSseEvent(event))).toEqual([event]);
    const plain = { id: null, event: "message", data: '{"kind":"x"}' };
    expect(formatSseEvent(plain)).toBe('data: {"kind":"x"}\n\n');
    expect(new SseParser().feed(formatSseEvent(plain))).toEqual([plain]);
  });
});
