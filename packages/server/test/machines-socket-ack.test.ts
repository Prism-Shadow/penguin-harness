/**
 * This server's socket to a machine acknowledges a credit stream only when the machine said it
 * reads acks (machines/machine-sockets.ts): a machine older than acks closes the whole socket on
 * a frame it does not know, which would end every stream to it.
 *
 * - Given a stream whose start frame echoes `x-flow: credit`, `ack` sends the ack frame.
 * - Given a stream whose start frame does not (an older machine), `ack` sends nothing.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { MachineSocket } from "../src/machines/machine-sockets.js";
import type { Sink } from "../src/machines/machine-sockets.js";

let machine: WebSocketServer;
let peer: Promise<WebSocket>;
const received: Array<Record<string, unknown>> = [];
let onReceived: () => void = () => undefined;

/** Resolves once the machine has received frames that satisfy `done`. */
const until = (done: () => boolean) =>
  new Promise<void>((resolve) => {
    if (done()) return resolve();
    onReceived = () => {
      if (done()) resolve();
    };
  });

beforeAll(async () => {
  machine = new WebSocketServer({ port: 0 });
  peer = new Promise((resolve) =>
    machine.on("connection", (ws) => {
      ws.on("message", (data) => {
        received.push(JSON.parse(data.toString()) as Record<string, unknown>);
        onReceived();
      });
      resolve(ws);
    }),
  );
  await new Promise<void>((resolve) => machine.once("listening", () => resolve()));
});
afterAll(async () => {
  await new Promise<void>((resolve) => machine.close(() => resolve()));
});

describe("acks to a machine", () => {
  it("go only on a stream whose start frame echoed x-flow: credit", async () => {
    const agent = new http.Agent();
    const socket = await MachineSocket.open(
      { agent, port: (machine.address() as AddressInfo).port, cookie: "c=1", session: 1 },
      5_000,
    );
    const ws = await peer;
    const started = (id: number) =>
      new Promise<void>((resolve) => {
        const sink: Sink = {
          onStart: () => resolve(),
          onEvent: () => undefined,
          onEnd: () => undefined,
          onResponse: () => undefined,
        };
        expect(
          socket.call(
            { method: "GET", path: `/api/s${id}`, headers: { "x-flow": "credit" } },
            sink,
          ),
        ).toBe(id);
      });
    const newer = started(1);
    const older = started(2);
    // The calls reach the machine before it answers either.
    await until(() => received.length >= 2);
    ws.send(JSON.stringify({ id: 1, status: 200, stream: true, headers: { "x-flow": "credit" } }));
    ws.send(JSON.stringify({ id: 2, status: 200, stream: true, headers: {} }));
    await Promise.all([newer, older]);
    socket.ack(1, 4096);
    socket.ack(2, 4096);
    socket.cancel(1); // a frame after both, so everything before it has arrived when it has
    await until(() => received.some((f) => f.cancel === true));
    expect(received.filter((f) => "ack" in f)).toEqual([{ id: 1, ack: 4096 }]);
    socket.terminate();
    agent.destroy();
  });
});
