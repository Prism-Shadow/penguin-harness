/**
 * The relay over a machine's API socket (machines/socket-relay.ts) against a scripted machine:
 * a socket that keeps its heartbeat but never opens the stream — what a machine's own hot push
 * leaves behind when the socket stays bound to its disposed App — is given up on in time,
 * torn down so the next stream dials the machine's current App, and this request is handed
 * back for the HTTP forward.
 */
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { MachineSocketRelay } from "../src/machines/socket-relay.js";

/** A machine's socket endpoint the test scripts: `answer` decides what a call frame gets. */
async function machine(answer: (ws: WebSocket, frame: { id: number }) => void) {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const connections: WebSocket[] = [];
  wss.on("connection", (ws) => {
    connections.push(ws);
    const beat = setInterval(() => ws.send(JSON.stringify({ heartbeat: true })), 20);
    ws.on("close", () => clearInterval(beat));
    ws.on("message", (data) => answer(ws, JSON.parse(data.toString()) as { id: number }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    connections,
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of connections) ws.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}

describe("the machine socket relay", () => {
  let stop: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await stop?.();
    stop = null;
  });

  it("gives up on a stream the machine never opens, tears the socket down, and dials again next time", async () => {
    let opens = 0;
    const m = await machine((ws, frame) => {
      opens += 1;
      // The first socket is the dead one: it heartbeats and says nothing. The second answers.
      if (m.connections.length === 1) return;
      ws.send(JSON.stringify({ id: frame.id, status: 200, stream: true, headers: {} }));
    });
    stop = m.close;
    const lines: string[] = [];
    const relay = new MachineSocketRelay((l) => lines.push(l), { openTimeoutMs: 150 });
    const target = { agent: new http.Agent(), port: m.port, cookie: "penguin_session=x" };

    const first = await relay.stream("m1", target, { path: "/api/events", lastEventId: null });
    expect(first).toBeNull(); // the caller forwards this one over HTTP
    expect(opens).toBe(1);
    expect(lines.some((l) => l.includes("not opened in 150 ms") && l.includes("m1"))).toBe(true);
    // The dead socket was torn down…
    await new Promise((r) => setTimeout(r, 50));
    expect(m.connections[0]!.readyState).toBe(m.connections[0]!.CLOSED);
    // …and the next stream dials afresh and opens.
    const second = await relay.stream("m1", target, { path: "/api/events", lastEventId: null });
    expect(second?.status).toBe(200);
    expect(second?.headers.get("content-type")).toBe("text/event-stream");
    expect(m.connections).toHaveLength(2);
  });

  it("leaves a stream that opens in time alone", async () => {
    const m = await machine((ws, frame) => {
      ws.send(JSON.stringify({ id: frame.id, status: 200, stream: true, headers: {} }));
    });
    stop = m.close;
    const lines: string[] = [];
    const relay = new MachineSocketRelay((l) => lines.push(l), { openTimeoutMs: 150 });
    const res = await relay.stream(
      "m1",
      { agent: new http.Agent(), port: m.port, cookie: "penguin_session=x" },
      { path: "/api/events", lastEventId: null },
    );
    expect(res?.status).toBe(200);
    await new Promise((r) => setTimeout(r, 250));
    expect(lines).toEqual([]);
    expect(m.connections[0]!.readyState).toBe(m.connections[0]!.OPEN);
  });
});
