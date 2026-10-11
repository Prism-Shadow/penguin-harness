/**
 * The relay over a machine's API socket (machines/socket-relay.ts) against a scripted machine:
 * a socket that keeps its heartbeat but never opens the stream — what a machine's own hot push
 * leaves behind when the socket stays bound to its disposed App — is given up on in time and
 * torn down so the next stream dials the machine's current App; a dial that never completes
 * is given up on too; a socket is never reused across ssh sessions; and no failure is ever
 * handed back for an HTTP forward — every one is answered with its reason.
 */
import http from "node:http";
import net from "node:net";
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

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

const opensAll = (ws: WebSocket, frame: { id: number }) =>
  ws.send(JSON.stringify({ id: frame.id, status: 200, stream: true, headers: {} }));

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
    const target = {
      agent: new http.Agent(),
      port: m.port,
      cookie: "penguin_session=x",
      session: 1,
    };

    const first = await relay.stream("m1", target, { path: "/api/events", lastEventId: null });
    expect(first.status).toBe(504); // answered with the reason — never forwarded over HTTP
    expect(await errorCode(first)).toBe("machine_stream_not_opened");
    expect(opens).toBe(1);
    expect(lines.some((l) => l.includes("not opened in 150 ms") && l.includes("m1"))).toBe(true);
    // The dead socket was torn down…
    await new Promise((r) => setTimeout(r, 50));
    expect(m.connections[0]!.readyState).toBe(m.connections[0]!.CLOSED);
    // …and the next stream dials afresh and opens.
    const second = await relay.stream("m1", target, { path: "/api/events", lastEventId: null });
    expect(second.status).toBe(200);
    expect(second.headers.get("content-type")).toBe("text/event-stream");
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
      { agent: new http.Agent(), port: m.port, cookie: "penguin_session=x", session: 1 },
      { path: "/api/events", lastEventId: null },
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 250));
    expect(lines).toEqual([]);
    expect(m.connections[0]!.readyState).toBe(m.connections[0]!.OPEN);
  });

  it("gives up on a dial the machine accepts and never answers, and dials again next time", async () => {
    // A machine that takes the connection and never answers the upgrade: without a deadline
    // the dial's promise stays pending and every later stream waits behind it.
    const held: net.Socket[] = [];
    const silent = net.createServer((sock) => held.push(sock));
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const port = (silent.address() as { port: number }).port;
    stop = () =>
      new Promise<void>((resolve) => {
        for (const sock of held) sock.destroy();
        silent.close(() => resolve());
      });
    const lines: string[] = [];
    const relay = new MachineSocketRelay((l) => lines.push(l), { dialTimeoutMs: 100 });
    const target = { agent: new http.Agent(), port, cookie: "penguin_session=x", session: 1 };

    const started = Date.now();
    const first = await relay.stream("m1", target, { path: "/api/events", lastEventId: null });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(first.status).toBe(502);
    expect(await errorCode(first)).toBe("machine_socket_unavailable");
    expect(lines.some((l) => l.includes("no socket handshake in 100 ms"))).toBe(true);
    // Not remembered as a refusal: the next stream dials again.
    await relay.stream("m1", target, { path: "/api/events", lastEventId: null });
    expect(held.length).toBe(2);
  });

  it("answers a machine that refuses the handshake with its reason, and does not ask again for a while", async () => {
    let upgrades = 0;
    const server = http.createServer((_req, res) => {
      res.writeHead(404).end();
    });
    server.on("upgrade", (_req, sock: net.Socket) => {
      upgrades += 1;
      sock.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    stop = () => new Promise<void>((resolve) => server.close(() => resolve()));
    const relay = new MachineSocketRelay(() => undefined);
    const target = { agent: new http.Agent(), port, cookie: "penguin_session=x", session: 1 };

    const first = await relay.stream("m1", target, { path: "/api/events", lastEventId: null });
    expect(first.status).toBe(502);
    expect(await errorCode(first)).toBe("machine_socket_refused");
    const second = await relay.stream("m1", target, { path: "/api/events", lastEventId: null });
    expect(await errorCode(second)).toBe("machine_socket_refused");
    expect(upgrades).toBe(1);
  });

  it("never reuses a socket across ssh sessions: a replaced session drops the old socket and dials anew", async () => {
    const m = await machine(opensAll);
    stop = m.close;
    const lines: string[] = [];
    const relay = new MachineSocketRelay((l) => lines.push(l));
    const base = { agent: new http.Agent(), port: m.port, cookie: "penguin_session=x" };

    const first = await relay.stream(
      "m1",
      { ...base, session: 1 },
      { path: "/api/events", lastEventId: null },
    );
    expect(first.status).toBe(200);
    const again = await relay.stream(
      "m1",
      { ...base, session: 1 },
      { path: "/api/events", lastEventId: null },
    );
    expect(again.status).toBe(200);
    expect(m.connections).toHaveLength(1);

    const moved = await relay.stream(
      "m1",
      { ...base, session: 2 },
      { path: "/api/events", lastEventId: null },
    );
    expect(moved.status).toBe(200);
    expect(m.connections).toHaveLength(2);
    expect(lines.some((l) => l.includes("was replaced"))).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(m.connections[0]!.readyState).toBe(m.connections[0]!.CLOSED);
    expect(m.connections[1]!.readyState).toBe(m.connections[1]!.OPEN);
  });
});
