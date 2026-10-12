/**
 * The event relay: a connected machine's own user-level events carried into this server's
 * stream, so the page holds one event stream whatever the number of machines.
 *
 * The machine's server is a real HTTP server on loopback speaking `text/event-stream`, and the
 * dial is a plain agent to it — the one boundary faked is the ssh session the real dial rides.
 *
 * Scenarios:
 * - Given a machine's stream, each server event it says reaches this server's admins named by
 *   the machine; its handshake and its pings do not.
 * - Given a stream that ends, it is taken up again from the last event the machine said.
 * - Given a machine whose server is gone, the subscription is reported lost once, and let go.
 * - Given a session the machine refuses, a fresh one is asked for.
 * - Given a stop, the subscription ends and nothing is reported lost.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { MachineEventRelay } from "../src/machines/event-relay.js";
import type { ServerEvent } from "../src/api/types.js";
import { waitFor } from "./helpers.js";

/** A machine's server: answers GET /api/events with whatever `respond` writes. */
async function machineServer(
  respond: (req: http.IncomingMessage, res: http.ServerResponse, nth: number) => void,
) {
  let nth = 0;
  const asked: Array<{ lastEventId: string | undefined; cookie: string | undefined }> = [];
  const server = http.createServer((req, res) => {
    asked.push({
      lastEventId: req.headers["last-event-id"] as string | undefined,
      cookie: req.headers.cookie,
    });
    respond(req, res, nth++);
  });
  const port = await new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
  return {
    port,
    asked,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** An event stream's head, then frames. */
function stream(res: http.ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
}
const frame = (event: string, id: string | null, data: unknown) =>
  `${id === null ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("machine event relay", () => {
  const relays: MachineEventRelay[] = [];
  const servers: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    for (const relay of relays.splice(0)) relay.stopAll();
    for (const server of servers.splice(0)) await server.close();
  });

  const relayTo = (
    port: () => number | null,
    hooks: { lost?: (address: string) => void; refused?: (address: string) => void } = {},
  ) => {
    const published: Array<{ machineId: string; event: ServerEvent }> = [];
    let cookie = "penguin_session=first";
    const relay = new MachineEventRelay({
      dial: async () => {
        const at = port();
        return at === null ? null : { agent: new http.Agent(), port: at, cookie };
      },
      publish: (machineId, event) => published.push({ machineId, event }),
      lost: (address) => hooks.lost?.(address),
      refused: (address) => {
        cookie = "penguin_session=fresh";
        hooks.refused?.(address);
      },
    });
    relays.push(relay);
    return { relay, published };
  };

  it("carries the machine's server events, named by the machine, and nothing else", async () => {
    const server = await machineServer((_req, res) => {
      stream(res);
      res.write(frame("server_event", "e-1", { type: "hello" }));
      res.write("event: ping\ndata: {}\n\n");
      res.write(": a comment\n\n");
      res.write(
        frame("server_event", "e-2", {
          type: "session_title",
          sessionId: "s1",
          title: "Where it runs",
        }),
      );
    });
    servers.push(server);
    const { relay, published } = relayTo(() => server.port);
    relay.start("ssh:nas", "NASmachineID0000");
    await waitFor(() => published.length === 1);
    expect(published).toEqual([
      {
        machineId: "NASmachineID0000",
        event: { type: "session_title", sessionId: "s1", title: "Where it runs" },
      },
    ]);
    expect(relay.active("ssh:nas")).toBe(true);
  });

  it("takes up a stream that ended from the last event the machine said", async () => {
    const server = await machineServer((_req, res, nth) => {
      stream(res);
      if (nth === 0) {
        res.end(frame("server_event", "e-7", { type: "resync_required" }));
        return;
      }
      res.write(frame("server_event", "e-8", { type: "credentials_updated" }));
    });
    servers.push(server);
    const { relay, published } = relayTo(() => server.port);
    relay.start("ssh:nas", "NASmachineID0000");
    await waitFor(() => published.length === 2);
    expect(server.asked.map((a) => a.lastEventId)).toEqual([undefined, "e-7"]);
    expect(published.map((p) => p.event.type)).toEqual(["resync_required", "credentials_updated"]);
  });

  it("reports a machine whose server is gone as lost, once, and lets it go", async () => {
    const lost: string[] = [];
    // Nothing listens on the port: every dial is refused.
    const gone = await machineServer(() => undefined);
    const port = gone.port;
    await gone.close();
    const { relay } = relayTo(() => port, { lost: (address) => lost.push(address) });
    relay.start("ssh:nas", "NASmachineID0000");
    await waitFor(() => lost.length === 1, 10_000);
    expect(lost).toEqual(["ssh:nas"]);
    expect(relay.active("ssh:nas")).toBe(false);
  });

  it("asks for a fresh session when the machine refuses the one it was given", async () => {
    const refused: string[] = [];
    const server = await machineServer((req, res) => {
      if (req.headers.cookie === "penguin_session=first") {
        res.writeHead(401).end();
        return;
      }
      stream(res);
      res.write(frame("server_event", "e-1", { type: "credentials_updated" }));
    });
    servers.push(server);
    const { relay, published } = relayTo(() => server.port, {
      refused: (address) => refused.push(address),
    });
    relay.start("ssh:nas", "NASmachineID0000");
    await waitFor(() => published.length === 1, 10_000);
    expect(refused).toEqual(["ssh:nas"]);
    expect(server.asked.map((a) => a.cookie)).toEqual([
      "penguin_session=first",
      "penguin_session=fresh",
    ]);
  });

  it("a stop ends the subscription, and nothing is reported lost", async () => {
    const lost: string[] = [];
    const server = await machineServer((_req, res) => {
      stream(res);
      res.write(frame("server_event", "e-1", { type: "credentials_updated" }));
    });
    servers.push(server);
    const { relay, published } = relayTo(() => server.port, {
      lost: (address) => lost.push(address),
    });
    relay.start("ssh:nas", "NASmachineID0000");
    await waitFor(() => published.length === 1);
    relay.stop("ssh:nas");
    await server.close();
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(lost).toEqual([]);
    expect(relay.active("ssh:nas")).toBe(false);
  });
});
