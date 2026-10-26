/**
 * Machine traffic never goes through a proxy.
 *
 * A machine's API is reached as a channel inside the ssh session this server holds to it: a
 * SOCKS5 CONNECT on the session's loopback `-D` port, carried by node:http with an agent of its
 * own (machines/transport). Here a small SOCKS server of this test's own stands in for that
 * port, and an HTTP server behind it for the machine's server.
 *
 * - Given proxy variables that name a proxy nobody runs, and this server's global dispatcher
 *   pinned to a proxy that answers 502 to everything, a call to a machine's API is answered by
 *   the machine, and the proxy sees nothing.
 * - Given the same, a page's request through the `/server/<machineId>/…` forward is answered by
 *   the machine too.
 */
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import { machineApi } from "../src/machines/machine-api.js";
import { machinesProxy } from "../src/machines/proxy.js";
import { dialThroughSocks } from "../src/machines/transport/socks.js";
import { buildProxyDispatcher } from "../src/net/proxy.js";

const listen = (server: net.Server): Promise<number> =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );

/** Just enough SOCKS5 for a CONNECT to an IPv4 address, piped to that port on loopback. */
function socksServer(): net.Server {
  return net.createServer((client) => {
    let stage = 0;
    let buffer = Buffer.alloc(0);
    client.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 0) {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]!) return;
        buffer = buffer.subarray(2 + buffer[1]!);
        stage = 1;
        client.write(Buffer.from([5, 0]));
      }
      if (stage === 1) {
        if (buffer.length < 10) return;
        stage = 2;
        const port = buffer.readUInt16BE(8);
        const rest = buffer.subarray(10);
        const upstream = net.connect({ host: "127.0.0.1", port }, () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          if (rest.length > 0) upstream.write(rest);
          client.pipe(upstream).pipe(client);
        });
        upstream.on("error", () => client.destroy());
      }
    });
  });
}

/** The agent MachineConnection.agent builds, with this test's SOCKS port in place of the session's. */
function sessionAgent(socksPort: number, remotePort: number): http.Agent {
  const agent = new http.Agent({ keepAlive: false });
  (agent as unknown as { createConnection: unknown }).createConnection = (
    _options: unknown,
    callback: (err: Error | null, socket?: net.Socket) => void,
  ) => {
    dialThroughSocks(socksPort, "127.0.0.1", remotePort).then(
      (socket) => callback(null, socket),
      (err: unknown) => callback(err instanceof Error ? err : new Error(String(err))),
    );
  };
  return agent;
}

describe("machine traffic and the proxy settings", () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.unstubAllEnvs();
  });

  /**
   * A machine behind a SOCKS port, a proxy that answers 502 to everything (and counts what it
   * saw), the proxy variables pointing at a port nothing listens on, and the global dispatcher
   * pinned to the 502 proxy.
   */
  async function rig() {
    const machine = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ answeredBy: "the machine", path: req.url, host: req.headers.host }));
    });
    const machinePort = await listen(machine);
    const socks = socksServer();
    const socksPort = await listen(socks);
    const seenByProxy: string[] = [];
    const proxy = http.createServer((req, res) => {
      seenByProxy.push(`${req.method} ${req.url}`);
      res.writeHead(502, { "content-type": "text/html" }).end("<h1>502 Bad Gateway</h1>");
    });
    proxy.on("connect", (req, socket) => {
      seenByProxy.push(`CONNECT ${req.url}`);
      socket.end("HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n");
    });
    const proxyPort = await listen(proxy);
    const dead = net.createServer();
    const deadPort = await listen(dead);
    await new Promise<void>((resolve) => dead.close(() => resolve()));

    const nowhere = `http://127.0.0.1:${deadPort}`;
    for (const name of ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"]) {
      vi.stubEnv(name, nowhere);
    }
    vi.stubEnv("all_proxy", `socks5://127.0.0.1:${deadPort}`);
    const previous = getGlobalDispatcher();
    const dispatcher = buildProxyDispatcher({
      proxyForApp: true,
      proxyUrl: `http://127.0.0.1:${proxyPort}`,
    });
    setGlobalDispatcher(dispatcher);
    cleanups.push(
      () => void machine.close(),
      () => void socks.close(),
      () => void proxy.close(),
      async () => {
        setGlobalDispatcher(previous);
        await dispatcher.close();
      },
    );
    return { machinePort, socksPort, seenByProxy };
  }

  it("a call to a machine's API is answered by the machine, and the proxy sees nothing", async () => {
    const { machinePort, socksPort, seenByProxy } = await rig();
    const api = machineApi(sessionAgent(socksPort, machinePort), machinePort, "penguin_session=x");

    const answer = await api.request("GET", "/api/version");

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toMatchObject({
      answeredBy: "the machine",
      path: "/api/version",
      host: `localhost:${machinePort}`,
    });
    expect(seenByProxy).toEqual([]);
  });

  it("a page's request through the /server/<machineId> forward is answered by the machine", async () => {
    const { machinePort, socksPort, seenByProxy } = await rig();
    const forward = machinesProxy(async () => ({
      agent: sessionAgent(socksPort, machinePort),
      port: machinePort,
      cookie: "penguin_session=x",
      adoptedAt: null,
      session: 1,
    }));

    const res = await forward(
      new Request("http://localhost:7368/server/QS7J4YVgSovi-Z2c/api/projects/p/agents"),
    );

    expect(res?.status).toBe(200);
    expect(await res?.json()).toMatchObject({
      answeredBy: "the machine",
      path: "/api/projects/p/agents",
    });
    expect(seenByProxy).toEqual([]);
  });
});
