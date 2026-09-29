/**
 * The SOCKS5 dial: a CONNECT through the session's `-D` port, answered by a small SOCKS
 * server of this test's own, reaching an HTTP server behind it.
 *
 * - Given a port that answers, the dial carries HTTP to it.
 * - Given a port nothing listens on, the dial fails at once — whether the SOCKS server says so
 *   with a failure reply, or, as ssh does for a channel the machine refused, just closes.
 * - Given no SOCKS listener at all, the dial fails.
 */
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { FORWARD_ANSWER_TIMEOUT_MS } from "../src/machines/proxy.js";
import { SOCKS_HANDSHAKE_TIMEOUT_MS, dialThroughSocks } from "../src/machines/transport/socks.js";

/**
 * Just enough SOCKS5 to answer a CONNECT: greet, connect, pipe. A refused port is answered with
 * a failure reply, or — `silentRefusal`, what ssh's `-D` does when the machine refuses the
 * channel — by closing the client with no reply at all.
 */
function socksServer(
  opts: { silentRefusal?: boolean } = {},
): Promise<{ port: number; close: () => void; requests: number[] }> {
  const requests: number[] = [];
  const server = net.createServer((client) => {
    let stage = 0;
    // Each stage waits for its whole frame before reading it. A `data` event is a piece of a
    // byte stream, not a message: taking one as a complete greeting or CONNECT would read the
    // port from bytes that had not arrived, and reading past the end throws inside this
    // handler — an uncaught exception, which takes the worker down rather than failing a test.
    let buffer = Buffer.alloc(0);
    client.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // The greeting: version, one method count, that many methods.
      if (stage === 0) {
        if (buffer.length < 2) return;
        const greeting = 2 + buffer[1]!;
        if (buffer.length < greeting) return;
        buffer = buffer.subarray(greeting);
        stage = 1;
        client.write(Buffer.from([5, 0]));
      }
      // CONNECT to an IPv4 address: 4 header bytes, 4 of address, 2 of port.
      if (stage === 1) {
        if (buffer.length < 10) return;
        stage = 2;
        const port = buffer.readUInt16BE(8);
        buffer = buffer.subarray(10);
        requests.push(port);
        const upstream = net.connect({ host: "127.0.0.1", port }, () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          // Anything already read past the request belongs to the tunnel, not to us.
          if (buffer.length > 0) upstream.write(buffer);
          client.pipe(upstream).pipe(client);
        });
        upstream.on("error", () => {
          if (opts.silentRefusal === true) client.destroy();
          else client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
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

/**
 * A SOCKS server that greets and then does `onConnect` with the CONNECT instead of opening
 * it — to play the two answers a real one gives that are not a reply code.
 */
function scriptedSocks(
  onConnect: (client: net.Socket) => void,
): Promise<{ port: number; close: () => void }> {
  const clients: net.Socket[] = [];
  const server = net.createServer((client) => {
    clients.push(client);
    let buffer = Buffer.alloc(0);
    let greeted = false;
    client.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!greeted) {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]!) return;
        buffer = buffer.subarray(2 + buffer[1]!);
        greeted = true;
        client.write(Buffer.from([5, 0]));
      }
      if (greeted && buffer.length >= 10) {
        buffer = Buffer.alloc(0);
        onConnect(client);
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => {
          for (const c of clients) c.destroy();
          server.close();
        },
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

  it("fails at once when the session closes a refused channel without a word, as ssh does", async () => {
    const socks = await socksServer({ silentRefusal: true });
    cleanups.push(socks.close);
    const probe = net.createServer();
    const free = await new Promise<number>((resolve) =>
      probe.listen(0, "127.0.0.1", () => {
        const port = (probe.address() as net.AddressInfo).port;
        probe.close(() => resolve(port));
      }),
    );
    const started = Date.now();
    await expect(dialThroughSocks(socks.port, "127.0.0.1", free)).rejects.toThrow(
      /nothing answered at 127\.0\.0\.1:\d+/,
    );
    // Not after the handshake's own timeout: the closed channel is the answer.
    expect(Date.now() - started).toBeLessThan(5_000);
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

  it("fails at once, naming it, when the SOCKS server closes the channel without a reply", async () => {
    // What OpenSSH's -D does when the far side has nothing listening on the port (or the
    // session is going down): no failure reply, the connection just closes. The handshake
    // deadline dies with the socket, so this must be read as the failure it is.
    const socks = await scriptedSocks((client) => client.end());
    cleanups.push(socks.close);
    const started = Date.now();
    await expect(dialThroughSocks(socks.port, "127.0.0.1", 7364)).rejects.toThrow(
      /closed the channel to 127\.0\.0\.1:7364 before answering/,
    );
    expect(Date.now() - started).toBeLessThan(SOCKS_HANDSHAKE_TIMEOUT_MS / 4);
  });

  it("gives up in its own words when a stalled session never answers the CONNECT", async () => {
    // A session whose link has stalled: the channel open never comes back, nothing closes.
    const socks = await scriptedSocks(() => undefined);
    cleanups.push(socks.close);
    await expect(dialThroughSocks(socks.port, "127.0.0.1", 7364, 100)).rejects.toThrow(
      /SOCKS handshake timed out/,
    );
  });

  it("keeps its deadline under the proxy's, and both under the browser's 20 s", () => {
    // The order is the point: a stalled session is reported by this layer before the proxy
    // gives up on the read, and the proxy answers before the browser stops listening.
    expect(SOCKS_HANDSHAKE_TIMEOUT_MS).toBeLessThan(FORWARD_ANSWER_TIMEOUT_MS);
    expect(FORWARD_ANSWER_TIMEOUT_MS).toBeLessThan(20_000);
  });
});
