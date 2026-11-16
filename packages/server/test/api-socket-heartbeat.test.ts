/**
 * Which peers the API socket's heartbeat ends (socket/serve.ts). The server pings each beat and
 * ends a peer it has heard nothing from since the last one. A hub pings the machine while it
 * still hears that machine's link; on a slow link the machine's own ping waits behind its queued
 * output, so the hub's pong can come later than a beat while the hub is receiving all along.
 *
 * - Given a peer that pings every ten seconds and never answers the server's pings, it is kept
 *   across several beats.
 * - Given a peer that neither pings, answers nor sends anything, it is ended after one silent beat.
 *
 * The socket is a stand-in with the `ws` surface serveApiSocket uses; time is faked.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { HEARTBEAT_MS, serveApiSocket } from "../src/socket/serve.js";

class StandInSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  terminated = false;
  send() {}
  ping() {}
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  terminate() {
    this.terminated = true;
    this.close();
  }
}

function served(): StandInSocket {
  const ws = new StandInSocket();
  serveApiSocket(ws as unknown as WebSocket, {
    fetch: async () => Response.json({}),
    fetchStream: async () => new Response(null),
    origin: "http://localhost:7364",
    log: () => undefined,
  });
  return ws;
}

describe("the API socket's heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a peer that pings every ten seconds though it never answers a ping", async () => {
    const ws = served();
    const pinging = setInterval(() => ws.emit("ping", Buffer.alloc(0)), 10_000);
    await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_MS);
    expect(ws.terminated).toBe(false);
    clearInterval(pinging);
    ws.close();
  });

  it("ends a peer that neither pings, answers nor sends after one silent beat", async () => {
    const ws = served();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(ws.terminated).toBe(false); // the beat's own ping is out; nothing heard yet
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(ws.terminated).toBe(true);
  });
});
