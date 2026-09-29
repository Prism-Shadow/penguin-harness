/**
 * The same-origin proxy: which paths it claims, how a remote's redirects are re-rooted, and
 * what each forwarded request reports having learned. Everything is addressed by the
 * MACHINE'S own id rather than the ssh alias.
 */
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  SERVER_PROXY_PREFIX,
  machinesProxy,
  parseProxyPath,
  rewriteLocation,
} from "../src/machines/proxy.js";
import { dialThroughSocks } from "../src/machines/transport/socks.js";

/** A machine, by the id it minted. */
const A = "QS7J4YVgSovi-Z2c";

describe("parseProxyPath", () => {
  it("claims /server/<machineId>/api/… and names both halves", () => {
    expect(parseProxyPath(`${SERVER_PROXY_PREFIX}${A}/api/me`)).toEqual({
      machineId: A,
      remotePath: "/api/me",
    });
  });

  it("needs no percent-encoding — a machine id is base64url by construction", () => {
    const path = `${SERVER_PROXY_PREFIX}${A}/api/me`;
    expect(path).not.toContain("%");
    expect(parseProxyPath(path)?.machineId).toBe(A);
  });

  it("forwards ONLY /api — a remote's pages are never proxied", () => {
    expect(parseProxyPath(`${SERVER_PROXY_PREFIX}${A}/`)).toBeNull();
    expect(parseProxyPath(`${SERVER_PROXY_PREFIX}${A}/index.html`)).toBeNull();
    expect(parseProxyPath(`${SERVER_PROXY_PREFIX}${A}/preview/x`)).toBeNull();
  });

  it("declines anything that is not the proxy prefix", () => {
    expect(parseProxyPath("/api/me")).toBeNull();
    expect(parseProxyPath("/server/")).toBeNull();
    expect(parseProxyPath(`/server/${A}`)).toBeNull();
  });
});

describe("rewriteLocation", () => {
  it("re-roots an absolute redirect under this machine's prefix", () => {
    expect(rewriteLocation("/api/login", A)).toBe(`${SERVER_PROXY_PREFIX}${A}/api/login`);
  });

  it("leaves an absolute URL alone — it is not ours to re-root", () => {
    expect(rewriteLocation("https://example.com/x", A)).toBe("https://example.com/x");
  });
});

describe("the report", () => {
  /** What a forwarded request learned, as noteApiSeen would hear it. */
  let upstream: http.Server | null = null;

  afterEach(() => {
    upstream?.close();
    upstream = null;
  });

  const listen = (): Promise<number> =>
    new Promise((resolve) => {
      upstream = http.createServer((_req, res) => {
        res.statusCode = 500; // Any HTTP answer is an ANSWER — a refusing server is alive.
        res.end("{}");
      });
      upstream.listen(0, "127.0.0.1", () => {
        resolve((upstream!.address() as { port: number }).port);
      });
    });

  const request = (machineId: string) =>
    new Request(`http://app.local${SERVER_PROXY_PREFIX}${machineId}/api/me`);

  it("hands the machine its own session and none of this server's credentials", async () => {
    // The proxy speaks to the machine as ITS admin. A caller's bearer is a credential for
    // THIS server: sent on, it would both reach another machine and outrank the cookie the
    // proxy just minted, since the remote's auth reads a bearer before a session.
    let got: http.IncomingHttpHeaders | null = null;
    upstream = http.createServer((req, res) => {
      got = req.headers;
      res.statusCode = 200;
      res.end("{}");
    });
    const port = await new Promise<number>((resolve) =>
      upstream!.listen(0, "127.0.0.1", () => resolve((upstream!.address() as AddressInfo).port)),
    );
    const proxy = machinesProxy(async () => ({
      agent: new http.Agent(),
      port,
      cookie: "penguin_session=minted",
      session: 1,
    }));
    await proxy(
      new Request(`http://app.local${SERVER_PROXY_PREFIX}${A}/api/me`, {
        headers: { authorization: "Bearer this-server's-token", cookie: "penguin_session=local" },
      }),
    );

    expect(got).not.toBeNull();
    expect(got!.authorization).toBeUndefined();
    expect(got!.cookie).toBe("penguin_session=minted");
  });

  it("says the machine answered on any HTTP answer, refusals included", async () => {
    const port = await listen();
    const seen: [string, { ok: boolean }][] = [];
    const proxy = machinesProxy(
      async () => ({ agent: new http.Agent(), port, cookie: "penguin_session=x", session: 1 }),
      (machineId, outcome) => seen.push([machineId, outcome]),
    );
    const response = await proxy(request(A));
    expect(response?.status).toBe(500);
    expect(seen).toEqual([[A, { ok: true }]]);
  });

  it("says the forward had nowhere to deliver when the socket fails, with the transport's words", async () => {
    const port = await listen();
    upstream!.close();
    upstream = null;
    const seen: [string, { ok: boolean; detail?: string }][] = [];
    const proxy = machinesProxy(
      async () => ({ agent: new http.Agent(), port, cookie: "penguin_session=x", session: 1 }),
      (machineId, outcome) => seen.push([machineId, outcome]),
    );
    const response = await proxy(request(A));
    expect(response?.status).toBe(502);
    expect(seen).toHaveLength(1);
    expect(seen[0]![1]).toMatchObject({ ok: false });
    expect((seen[0]![1] as { detail: string }).detail).not.toBe("");
  });

  it("answers 504 when the machine never answers a read, and says so", async () => {
    // A machine that took the connection and is not serving: without a deadline this
    // request — and every retry of it — would wait for good.
    let aborted = false;
    upstream = http.createServer((req) => {
      req.on("close", () => (aborted = true));
    });
    const port = await new Promise<number>((resolve) =>
      upstream!.listen(0, "127.0.0.1", () => resolve((upstream!.address() as AddressInfo).port)),
    );
    const seen: [string, { ok: boolean; detail?: string }][] = [];
    const proxy = machinesProxy(
      async () => ({ agent: new http.Agent(), port, cookie: "penguin_session=x", session: 1 }),
      (machineId, outcome) => seen.push([machineId, outcome]),
      undefined,
      {},
      { answerTimeoutMs: 100 },
    );
    const response = await proxy(request(A));
    expect(response?.status).toBe(504);
    const body = (await response!.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("machine_not_answering");
    expect(body.error.message).toContain("no answer to GET /api/me in 100 ms");
    expect(seen).toEqual([[A, { ok: false, detail: "no answer to GET /api/me in 100 ms" }]]);
    await new Promise((r) => setTimeout(r, 50));
    expect(aborted).toBe(true); // the forward was let go, not left holding a channel
    upstream!.closeAllConnections();
  });

  it("does not cut a write that the machine answers late", async () => {
    // A write may rightly take long, and cutting it would have the browser repeat its effect.
    upstream = http.createServer((_req, res) => {
      setTimeout(() => {
        res.statusCode = 200;
        res.end('{"done":true}');
      }, 250);
    });
    const port = await new Promise<number>((resolve) =>
      upstream!.listen(0, "127.0.0.1", () => resolve((upstream!.address() as AddressInfo).port)),
    );
    const proxy = machinesProxy(
      async () => ({ agent: new http.Agent(), port, cookie: "penguin_session=x", session: 1 }),
      undefined,
      undefined,
      {},
      { answerTimeoutMs: 100 },
    );
    const response = await proxy(
      new Request(`http://app.local${SERVER_PROXY_PREFIX}${A}/api/me`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response?.status).toBe(200);
    expect(await response!.json()).toEqual({ done: true });
  });

  it("answers a read at once, in the transport's words, when the session closes the channel", async () => {
    // OpenSSH's -D answers a CONNECT to a port with nothing listening by closing the
    // connection. The read must hear that now, not wait for any deadline.
    const socks = net.createServer((client) => {
      let greeted = false;
      client.on("data", (chunk: Buffer) => {
        if (!greeted) {
          greeted = true;
          client.write(Buffer.from([5, 0]));
          if (chunk.length <= 3) return;
        }
        client.end();
      });
    });
    await new Promise<void>((resolve) => socks.listen(0, "127.0.0.1", resolve));
    const socksPort = (socks.address() as AddressInfo).port;
    const agent = new http.Agent();
    (agent as unknown as { createConnection: unknown }).createConnection = (
      _options: unknown,
      callback: (err: Error | null, socket?: net.Socket) => void,
    ) => {
      dialThroughSocks(socksPort, "127.0.0.1", 7364).then(
        (socket) => callback(null, socket),
        (err: Error) => callback(err),
      );
    };
    const proxy = machinesProxy(async () => ({
      agent,
      port: 7364,
      cookie: "penguin_session=x",
      session: 1,
    }));
    const started = Date.now();
    const response = await proxy(request(A)).finally(() => socks.close());
    expect(response?.status).toBe(502);
    const body = (await response!.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("server_unreachable");
    expect(body.error.message).toContain("closed the channel to 127.0.0.1:7364");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("reports nothing when there is no forward to try — an unasked machine is unmeasured", async () => {
    const seen: unknown[] = [];
    const proxy = machinesProxy(
      async () => null,
      (machineId, outcome) => seen.push([machineId, outcome]),
    );
    const response = await proxy(request(A));
    expect(response?.status).toBe(503);
    expect(seen).toEqual([]);
  });
});

describe("a caller that gives up", () => {
  let upstream: http.Server | null = null;

  afterEach(() => {
    upstream?.closeAllConnections();
    upstream?.close();
    upstream = null;
  });

  /** A machine that takes the request and never answers, saying when the forward goes away. */
  const silentMachine = (): Promise<{ port: number; closed: Promise<void> }> =>
    new Promise((resolve) => {
      let onClosed: () => void = () => undefined;
      const closed = new Promise<void>((r) => (onClosed = r));
      upstream = http.createServer((req) => {
        req.socket.on("close", () => onClosed());
      });
      upstream.listen(0, "127.0.0.1", () =>
        resolve({ port: (upstream!.address() as AddressInfo).port, closed }),
      );
    });

  it("drops the forward when the request is aborted, and does not call the machine unreachable", async () => {
    // An API socket call cancelled at its answer timeout aborts its Request (socket/serve.ts);
    // before, the forward stayed open on the silent route until the machine answered nobody.
    const { port, closed } = await silentMachine();
    const seen: unknown[] = [];
    const proxy = machinesProxy(
      async () => ({ agent: new http.Agent(), port, cookie: "penguin_session=x", session: 1 }),
      (machineId, outcome) => seen.push([machineId, outcome]),
    );
    const controller = new AbortController();
    const pending = proxy(
      new Request(`http://app.local${SERVER_PROXY_PREFIX}${A}/api/me`, {
        signal: controller.signal,
      }),
    );
    // Let the request reach the machine before giving up on it.
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await closed; // the machine sees the forward go away
    const response = await pending;
    expect(response?.status).toBe(499);
    expect(seen).toEqual([]);
  });

  it("does not dial at all for a request that was aborted already", async () => {
    let dialed = false;
    upstream = http.createServer(() => (dialed = true));
    const port = await new Promise<number>((resolve) =>
      upstream!.listen(0, "127.0.0.1", () => resolve((upstream!.address() as AddressInfo).port)),
    );
    const proxy = machinesProxy(async () => ({
      agent: new http.Agent(),
      port,
      cookie: "penguin_session=x",
      session: 1,
    }));
    const response = await proxy(
      new Request(`http://app.local${SERVER_PROXY_PREFIX}${A}/api/me`, {
        signal: AbortSignal.abort(),
      }),
    );
    expect(response?.status).toBe(499);
    await new Promise((r) => setTimeout(r, 50));
    expect(dialed).toBe(false);
  });
});
