/**
 * The same-origin proxy: which paths it claims, how a remote's redirects are re-rooted, what
 * it hands the machine (its own session, and when this server adopted it — never a caller's
 * credential or a caller's adoption time), and what each forwarded request reports having
 * learned. Everything is addressed by the MACHINE'S own id rather than the ssh alias.
 */
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  FORWARD_ANSWER_TIMEOUT_MS,
  SERVER_PROXY_PREFIX,
  browserFacing,
  machinesProxy,
  parseProxyPath,
  rewriteLocation,
} from "../src/machines/proxy.js";

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

describe("where the browser is", () => {
  it("tells the machine this server's origin and the prefix the machine sits under here", () => {
    expect(
      browserFacing(
        new Request(`http://hub.example.test:53531${SERVER_PROXY_PREFIX}${A}/api/me`),
        A,
        false,
      ),
    ).toEqual({
      "x-forwarded-host": "hub.example.test:53531",
      "x-forwarded-proto": "http",
      "x-forwarded-prefix": `/server/${A}`,
    });
  });

  it("never passes a caller's own forwarded values on, unless this server trusts its proxy", () => {
    const request = new Request(`http://hub.example.test:53531${SERVER_PROXY_PREFIX}${A}/api/me`, {
      headers: {
        "x-forwarded-host": "evil.example.test",
        "x-forwarded-proto": "https",
        "x-forwarded-prefix": "/elsewhere",
      },
    });
    expect(browserFacing(request, A, false)).toEqual({
      "x-forwarded-host": "hub.example.test:53531",
      "x-forwarded-proto": "http",
      "x-forwarded-prefix": `/server/${A}`,
    });
    // Behind a trusted reverse proxy, its client-facing hop is the browser's, and the prefix
    // composes: the machine sits under this server's own prefix.
    expect(browserFacing(request, A, true)).toEqual({
      "x-forwarded-host": "evil.example.test",
      "x-forwarded-proto": "https",
      "x-forwarded-prefix": `/elsewhere/server/${A}`,
    });
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
      adoptedAt: null,
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
    // Addressed as the machine's own loopback, told where the browser actually is.
    expect(got!.host).toBe(`localhost:${port}`);
    expect(got!["x-forwarded-host"]).toBe("app.local");
    expect(got!["x-forwarded-proto"]).toBe("http");
    expect(got!["x-forwarded-prefix"]).toBe(`/server/${A}`);
  });

  it("tells the machine when this server adopted it, and never passes on a caller's own word for it", async () => {
    // The time decides which of the machine's Sessions read as CLI tasks for this server's
    // admins: it is this server's record, set from that record or not at all.
    const heard: (string | string[] | undefined)[] = [];
    upstream = http.createServer((req, res) => {
      heard.push(req.headers["x-penguin-adopted-at"]);
      res.statusCode = 200;
      res.end("{}");
    });
    const port = await new Promise<number>((resolve) =>
      upstream!.listen(0, "127.0.0.1", () => resolve((upstream!.address() as AddressInfo).port)),
    );
    const forged = { headers: { "x-penguin-adopted-at": "2099-01-01T00:00:00.000Z" } };
    const adopted = machinesProxy(async () => ({
      agent: new http.Agent(),
      port,
      cookie: "penguin_session=x",
      adoptedAt: "2026-10-15T08:00:00.000Z",
      session: 1,
    }));
    await adopted(new Request(`http://app.local${SERVER_PROXY_PREFIX}${A}/api/me`, forged));
    const unrecorded = machinesProxy(async () => ({
      agent: new http.Agent(),
      port,
      cookie: "penguin_session=x",
      adoptedAt: null,
      session: 1,
    }));
    await unrecorded(new Request(`http://app.local${SERVER_PROXY_PREFIX}${A}/api/me`, forged));

    expect(heard).toEqual(["2026-10-15T08:00:00.000Z", undefined]);
  });

  it("says the machine answered on any HTTP answer, refusals included", async () => {
    const port = await listen();
    const seen: [string, { ok: boolean }][] = [];
    const proxy = machinesProxy(
      async () => ({
        agent: new http.Agent(),
        port,
        cookie: "penguin_session=x",
        adoptedAt: null,
        session: 1,
      }),
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
      async () => ({
        agent: new http.Agent(),
        port,
        cookie: "penguin_session=x",
        adoptedAt: null,
        session: 1,
      }),
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
      async () => ({ agent: new http.Agent(), port, cookie: "penguin_session=x", adoptedAt: null, session: 1 }),
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
      async () => ({ agent: new http.Agent(), port, cookie: "penguin_session=x", adoptedAt: null, session: 1 }),
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
    // connection, and the ssh kind's dial fails on that at once (plugins/machine-ssh, whose
    // test plays the SOCKS side). Here the dial fails the way it does there, and the read must
    // hear that now, not wait for any deadline.
    const agent = new http.Agent();
    (agent as unknown as { createConnection: unknown }).createConnection = (
      _options: unknown,
      callback: (err: Error | null, socket?: net.Socket) => void,
    ) => {
      setImmediate(() =>
        callback(
          new Error(
            "the session closed the channel to 127.0.0.1:7364 before answering — nothing is listening there, or the session is going down",
          ),
        ),
      );
    };
    const proxy = machinesProxy(async () => ({
      agent,
      port: 7364,
      cookie: "penguin_session=x",
      adoptedAt: null,
      session: 1,
    }));
    const started = Date.now();
    const response = await proxy(request(A));
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

describe("a machine a forward failed to", () => {
  const request = (machineId: string) =>
    new Request(`http://app.local${SERVER_PROXY_PREFIX}${machineId}/api/me`);

  /** An agent that fails every dial while `state.broken`, and dials `port` when it is not. */
  function agentOf(state: { broken: boolean }, port: number): http.Agent {
    const agent = new http.Agent();
    (agent as unknown as { createConnection: unknown }).createConnection = (
      options: net.NetConnectOpts,
      callback: (err: Error | null, socket?: net.Socket) => void,
    ) => {
      if (state.broken) {
        setImmediate(() =>
          callback(
            new Error(
              "the session closed the channel to 127.0.0.1:7364 before answering — nothing is listening there, or the session is going down",
            ),
          ),
        );
        return undefined;
      }
      const socket = net.connect(options);
      socket.once("connect", () => callback(null, socket));
      socket.once("error", (err) => callback(err));
      return socket;
    };
    return agent;
  }

  it("is not resolved again inside the cooldown: the next request is answered 503 with Retry-After", async () => {
    // The storm of 2026-10-21: the ssh channel was gone, so every attempt failed in about a
    // millisecond, and the page re-issued as fast as it could.
    let resolves = 0;
    const proxy = machinesProxy(
      async () => {
        resolves += 1;
        return {
          agent: agentOf({ broken: true }, 7364),
          port: 7364,
          cookie: "penguin_session=x",
          adoptedAt: null,
          session: 1,
        };
      },
      undefined,
      undefined,
      {},
      { cooldownMs: 60_000 },
    );

    const first = await proxy(request(A));
    expect(first?.status).toBe(502);
    const second = await proxy(request(A));
    expect(second?.status).toBe(503);
    expect(second!.headers.get("retry-after")).toBe("60");
    const body = (await second!.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("not_connected");
    expect(body.error.message).toContain("retry in 60 s");
    expect(resolves).toBe(1);
  });

  it("is dialled again once the cooldown passes, and a forward that answers clears it", async () => {
    const state = { broken: true };
    const upstream = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end('{"ok":true}');
    });
    const port = await new Promise<number>((resolve) =>
      upstream.listen(0, "127.0.0.1", () => resolve((upstream!.address() as AddressInfo).port)),
    );
    const agent = agentOf(state, port);
    let resolves = 0;
    const proxy = machinesProxy(
      async () => {
        resolves += 1;
        return { agent, port, cookie: "penguin_session=x", adoptedAt: null, session: 1 };
      },
      undefined,
      undefined,
      {},
      { cooldownMs: 50 },
    );
    try {
      expect((await proxy(request(A)))?.status).toBe(502);
      expect((await proxy(request(A)))?.status).toBe(503);
      expect(resolves).toBe(1);

      await new Promise((r) => setTimeout(r, 80));
      state.broken = false;
      const again = await proxy(request(A));
      expect(again?.status).toBe(200);
      expect(await again!.json()).toEqual({ ok: true });
      expect(resolves).toBe(2);
      // The answer cleared the record: the very next request is forwarded too.
      expect((await proxy(request(A)))?.status).toBe(200);
    } finally {
      upstream.closeAllConnections();
      upstream.close();
    }
  });
});

describe("the answer deadline", () => {
  it("sits under the browser's 20 s, so the browser hears the machine's 504 first", () => {
    // The ssh kind's SOCKS handshake deadline sits under this one; its test pins that side.
    expect(FORWARD_ANSWER_TIMEOUT_MS).toBeLessThan(20_000);
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
      async () => ({
        agent: new http.Agent(),
        port,
        cookie: "penguin_session=x",
        adoptedAt: null,
        session: 1,
      }),
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
      adoptedAt: null,
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
