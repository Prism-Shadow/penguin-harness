/**
 * A cancel frame for a one-shot call aborts that call's Request (socket/serve.ts).
 *
 * The web client sends one when it gives up on a call at its answer timeout (api/socket.ts),
 * and this abort is what reaches the route: the machine proxy drops its forward on it
 * (machines/proxy.ts, pinned in machines-proxy.test.ts). Without it a silent machine's route
 * kept every given-up call's forward open. The socket is a stand-in with the `ws` surface
 * serveApiSocket uses; the route is a fetch that never answers and records its Request.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { serveApiSocket } from "../src/socket/serve.js";

class StandInSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  ping() {}
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  terminate() {
    this.close();
  }
  frame(frame: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(frame)), false);
  }
}

describe("a cancel frame for a one-shot call", () => {
  it("aborts the Request the route is working on, and nothing is answered for it", async () => {
    const ws = new StandInSocket();
    const requests: Request[] = [];
    serveApiSocket(ws as unknown as WebSocket, {
      fetch: (request) => {
        requests.push(request);
        return new Promise<Response>((resolve) => {
          // Like the proxy: answers only once the caller has gone.
          request.signal.addEventListener("abort", () =>
            resolve(Response.json({ error: { code: "cancelled" } }, { status: 499 })),
          );
        });
      },
      origin: "http://localhost:7364",
      log: () => undefined,
    });
    ws.frame({
      id: 3,
      call: { method: "GET", path: "/server/m1/api/projects/p/agents/a/sessions" },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.signal.aborted).toBe(false);

    ws.frame({ id: 3, cancel: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(requests[0]!.signal.aborted).toBe(true);
    // The client already gave the call up: no answer frame follows the cancel.
    expect(ws.sent.filter((s) => (JSON.parse(s) as { id?: number }).id === 3)).toEqual([]);
    // And the id is free again (a reused in-flight id would close the socket).
    ws.frame({ id: 3, call: { method: "GET", path: "/api/me" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.readyState).toBe(1);
    ws.close();
  });
});
