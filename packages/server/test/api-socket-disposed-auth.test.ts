/**
 * A real cookie-authenticated WebSocket must reject a revoked login even while its App
 * has been disposed. Reassembling the App permits a fresh login and a new connection.
 * The same disposed-App entry is exercised by the hot-push grace-window tests in #1357;
 * authentication must reject before that entry handles a call or subscription.
 */
import { once } from "node:events";
import type { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { WebSocket } from "ws";
import { expect, it } from "vitest";
import { apiClient, createTestApp, loginAdmin, loginUser, provisionUser } from "./helpers.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import { apiSocketPath } from "../src/socket/ref.js";
import type { Reassembly } from "../src/hmr/capabilities.js";

it.each(["call", "subscribe"] as const)(
  "revocation precedes a disposed App's %s and fresh login reconnects",
  async (action) => {
    const t = await createTestApp();
    const admin = (await loginAdmin(t.app)).cookie;
    const userId = `disposed_${action}`;
    const old = await provisionUser(t.app, userId);
    let port = 0;
    const server = serve({ fetch: t.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      port = info.port;
    });
    if (!server.listening) await once(server, "listening");
    attachTerminalWebSocket(server as unknown as HttpServer, {
      hmr: t.deps.hmr,
      authService: t.deps.authService,
      log: () => undefined,
    });
    const sockets: WebSocket[] = [];
    const connect = async (cookie: string) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${apiSocketPath()}`, {
        headers: { host: `localhost:${port}`, cookie },
      });
      sockets.push(ws);
      await once(ws, "open");
      return ws;
    };
    const call = async (ws: WebSocket, id: number) => {
      const response = once(ws, "message");
      ws.send(JSON.stringify({ id, call: { method: "GET", path: "/api/me" } }));
      return JSON.parse(String((await response)[0])) as { status: number };
    };
    try {
      const ws = await connect(old.cookie);
      expect((await call(ws, 1)).status).toBe(200);
      expect(
        (
          await apiClient(t.app, admin).post(`/api/admin/users/${userId}/password`, {
            password: "new-password-456",
          })
        ).status,
      ).toBe(204);
      expect((await apiClient(t.app, old.cookie).get("/api/me")).status).toBe(401);
      const platform = await t.deps.hmr.ensure();
      const reassembly = t.deps.tree.api<Reassembly>("RuntimeModule", "Reassembly");
      const previous = platform.api.business()!;
      previous.dispose();
      expect(() => previous.api("HttpModule", "http")).toThrow();
      const frames: { status?: number; stream?: boolean }[] = [];
      ws.on("message", (data) => frames.push(JSON.parse(data.toString())));
      const closed = once(ws, "close");
      ws.send(
        JSON.stringify({
          id: 2,
          call: {
            method: "GET",
            path: action === "call" ? "/api/me" : "/api/events",
            ...(action === "subscribe" ? { headers: { accept: "text/event-stream" } } : {}),
          },
        }),
      );
      expect((await closed)[0]).toBe(1008);
      expect(frames).toEqual([]);
      expect(await reassembly.reassemble()).toBe(true);
      expect(platform.api.business()).not.toBe(previous);
      const fresh = await loginUser(t.app, userId, "new-password-456");
      const replacement = await connect(fresh.cookie);
      expect((await call(replacement, 3)).status).toBe(200);
    } finally {
      await Promise.all(
        sockets.map(async (ws) => {
          if (ws.readyState === WebSocket.CLOSED) return;
          const closed = once(ws, "close");
          ws.close();
          await closed;
        }),
      );
      (server as unknown as HttpServer).closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await t.cleanup();
    }
  },
);
