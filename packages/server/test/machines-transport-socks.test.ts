/**
 * The SOCKS5 dial: a CONNECT through the session's `-D` port, answered by a small SOCKS
 * server of this test's own, reaching an HTTP server behind it.
 */
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { dialThroughSocks } from "../src/machines/transport/socks.js";

/** Just enough SOCKS5 to answer a CONNECT: greet, connect, pipe. */
function socksServer(): Promise<{ port: number; close: () => void; requests: number[] }> {
  const requests: number[] = [];
  const server = net.createServer((client) => {
    let stage = 0;
    client.on("data", (chunk: Buffer) => {
      if (stage === 0) {
        stage = 1;
        client.write(Buffer.from([5, 0]));
        return;
      }
      if (stage === 1) {
        stage = 2;
        const port = chunk.readUInt16BE(8);
        requests.push(port);
        const upstream = net.connect({ host: "127.0.0.1", port }, () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          client.pipe(upstream).pipe(client);
        });
        upstream.on("error", () => {
          client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
        });
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => server.close(),
        requests,
      }),
    ),
  );
}

describe("dialThroughSocks", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  it("reaches a port behind the SOCKS server and carries HTTP over it", async () => {
    const web = http.createServer((_req, res) => res.end("ok from behind"));
    await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => web.close());
    const webPort = (web.address() as net.AddressInfo).port;
    const socks = await socksServer();
    cleanups.push(socks.close);

    const socket = await dialThroughSocks(socks.port, "127.0.0.1", webPort);
    const answer = await new Promise<string>((resolve) => {
      let text = "";
      socket.on("data", (chunk: Buffer) => (text += String(chunk)));
      socket.on("end", () => resolve(text));
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });
    expect(answer).toContain("ok from behind");
    expect(socks.requests).toEqual([webPort]);
  });

  it("fails in the SOCKS server's words when the port behind it refuses", async () => {
    const socks = await socksServer();
    cleanups.push(socks.close);
    // A port nothing listens on: taken from the kernel and released.
    const probe = net.createServer();
    const free = await new Promise<number>((resolve) =>
      probe.listen(0, "127.0.0.1", () => {
        const port = (probe.address() as net.AddressInfo).port;
        probe.close(() => resolve(port));
      }),
    );
    await expect(dialThroughSocks(socks.port, "127.0.0.1", free)).rejects.toThrow(
      /refused .*SOCKS reply 5/,
    );
  });

  it("fails when there is no SOCKS listener at all", async () => {
    const probe = net.createServer();
    const free = await new Promise<number>((resolve) =>
      probe.listen(0, "127.0.0.1", () => {
        const port = (probe.address() as net.AddressInfo).port;
        probe.close(() => resolve(port));
      }),
    );
    await expect(dialThroughSocks(free, "127.0.0.1", 7364)).rejects.toThrow(/did not answer/);
  });
});
