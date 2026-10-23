/**
 * The SSE writer (socket/sse-text.ts): the exact text this server puts on the wire — an id line
 * when the event has an id, an event line when it is named, and the data lines, closed by the
 * blank line.
 */
import { describe, expect, it } from "vitest";
import { formatSseEvent } from "../src/socket/sse-text.js";

describe("formatSseEvent", () => {
  it("writes the id and event lines a named, id-carrying event has", () => {
    expect(
      formatSseEvent({ id: "5-1", event: "server_event", data: '{"type":"task_state"}' }),
    ).toBe('id: 5-1\nevent: server_event\ndata: {"type":"task_state"}\n\n');
  });

  it("omits what an id-less, unnamed event does not carry", () => {
    expect(formatSseEvent({ id: null, event: "message", data: '{"kind":"x"}' })).toBe(
      'data: {"kind":"x"}\n\n',
    );
  });
});
