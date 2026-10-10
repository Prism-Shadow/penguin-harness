/**
 * An event stream over a real socket: the app served by @hono/node-server, read by a Node
 * HTTP client that stops reading, the way a dead peer or a stuck proxy does.
 *
 * - Given a subscriber that stopped reading while events keep coming, once its socket has
 *   sent nothing for the idle timeout the server destroys it and drops the subscription,
 *   and the client, reading again, finds the stream ended (which sends an EventSource to
 *   reconnect).
 */
import http from "node:http";
import net from "node:net";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { userText } from "@prismshadow/penguin-core";
import { sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

let t: TestApp;
let cookie: string;
let server: ReturnType<typeof serve>;
let port: number;

beforeAll(async () => {
  t = await createTestApp();
  ({ cookie } = await provisionUser(t.app, "wire"));
  await new Promise<void>((resolve) => {
    server = serve({ fetch: t.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      port = info.port;
      resolve();
    });
  });
});
afterAll(async () => {
  (server as http.Server).closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await t.cleanup();
});

it("a subscriber that stopped reading is cut off once its socket goes idle, and unsubscribed", async () => {
  // A socket's idle timer is Node's own, out of fake timers' reach: whatever idle timeout the
  // app asks for runs as 300 ms here.
  const setSocketTimeout = net.Socket.prototype.setTimeout;
  vi.spyOn(net.Socket.prototype, "setTimeout").mockImplementation(function (
    this: net.Socket,
    ms: number,
    callback?: () => void,
  ) {
    return setSocketTimeout.call(this, ms > 0 ? 300 : 0, callback);
  });
  const sessionId = uniqueSessionId();
  t.deps.sessionsRepo.insert(sessionRow(sessionId, { projectId: "wire-default_project" }));
  const channel = t.deps.channels.get(sessionId);
  const accepted = new Promise<net.Socket>((resolve) => server.once("connection", resolve));
  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const headers = { host: `localhost:${port}`, cookie };
    http
      .get(
        {
          host: "127.0.0.1",
          port,
          path: `/api/sessions/${sessionId}/stream`,
          headers,
          agent: false,
        },
        resolve,
      )
      .on("error", reject);
  });
  res.on("error", () => undefined);
  const socket = await accepted;
  await waitFor(() => channel.subscriberCount === 1);

  // The peer stops reading; events keep coming until the buffers are full and a write sticks.
  res.socket.pause();
  const body = "x".repeat(64 * 1024);
  const deadline = Date.now() + 3000;
  while (!socket.destroyed && Date.now() < deadline) {
    channel.publish(userText(body));
    channel.publish(userText(body));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(socket.destroyed).toBe(true);
  await waitFor(() => channel.subscriberCount === 0);

  res.socket.resume();
  res.resume();
  await waitFor(() => res.socket.destroyed);
});
