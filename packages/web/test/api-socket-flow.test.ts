/**
 * Acknowledged flow on the API socket client (api/socket.ts `StreamOptions.flow`), against a
 * scripted WebSocket.
 *
 * - Given a flow stream, its call says `x-flow: credit`, and after each event it has handled
 *   it acknowledges the event data handled so far, cumulatively — a frame it could not read
 *   included, so the server's window never stays shut.
 * - Given a flow stream re-issued after the server ended it, the new call counts from zero.
 * - Given a stream without flow, no ack is ever sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiSocket } from "../src/api/socket";
import type { StreamHandlers } from "../src/api/sse";
import { FakeSocket } from "./fake-socket";

let socket: ApiSocket;
beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
  socket = new ApiSocket(
    (userId) => `ws://test/socket/${userId}`,
    async () => "admin",
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const last = () => FakeSocket.instances[FakeSocket.instances.length - 1]!;
const handled: Array<[string, unknown]> = [];
const handlers: StreamHandlers = {
  onRecord: () => undefined,
  onServerEvent: () => undefined,
  onEvent: (name, data) => handled.push([name, data]),
};

async function openStream(flow: boolean) {
  handled.length = 0;
  const conn = socket.stream("/api/sessions/s1/history", handlers, { flow });
  await Promise.resolve();
  await Promise.resolve();
  last().open();
  last().receive({ id: 1, status: 200, stream: true, headers: {} });
  return conn;
}

const acks = () =>
  last()
    .frames()
    .filter((f) => "ack" in f);

describe("acknowledged flow", () => {
  it("a flow stream asks for credit and acknowledges what it handled, a skipped frame included", async () => {
    const conn = await openStream(true);
    const [issued] = last().frames();
    expect(issued).toMatchObject({
      id: 1,
      call: { headers: { accept: "text/event-stream", "x-flow": "credit" } },
    });
    const first = '{"windowId":"w1","offset":0,"text":"a"}';
    const unreadable = "{not json";
    const ping = "{}";
    last().receive({ id: 1, event: "records", eventId: "w1:1", data: first });
    last().receive({ id: 1, event: "records", eventId: null, data: unreadable });
    last().receive({ id: 1, event: "ping", eventId: null, data: ping });
    expect(handled).toEqual([["records", JSON.parse(first)]]);
    expect(acks()).toEqual([
      { id: 1, ack: first.length },
      { id: 1, ack: first.length + unreadable.length },
      { id: 1, ack: first.length + unreadable.length + ping.length },
    ]);
    conn.close();
  });

  it("a flow stream re-issued after the server ended it counts from zero", async () => {
    const conn = await openStream(true);
    last().receive({ id: 1, event: "records", eventId: "w1:3", data: '{"n":1}' });
    last().receive({ id: 1, end: true, reason: "closed" });
    await vi.advanceTimersByTimeAsync(1_000);
    const reissued = last()
      .frames()
      .filter((f) => "call" in f)
      .at(-1) as { id: number; call: { headers: Record<string, string> } };
    expect(reissued.call.headers).toMatchObject({ "x-flow": "credit", "last-event-id": "w1:3" });
    last().receive({ id: reissued.id, status: 200, stream: true, headers: {} });
    last().receive({ id: reissued.id, event: "records", eventId: "w1:5", data: '{"n":22}' });
    expect(acks().at(-1)).toEqual({ id: reissued.id, ack: '{"n":22}'.length });
    conn.close();
  });

  it("a stream without flow never acknowledges", async () => {
    const conn = await openStream(false);
    const [issued] = last().frames();
    expect((issued as { call: { headers: Record<string, string> } }).call.headers).toEqual({
      accept: "text/event-stream",
    });
    last().receive({ id: 1, event: "records", eventId: "w1:1", data: '{"n":1}' });
    expect(acks()).toEqual([]);
    conn.close();
  });
});
