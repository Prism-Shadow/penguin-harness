/**
 * The same-origin proxy: which paths it claims, how a remote's redirects are re-rooted, and
 * what each forwarded request reports having learned. Everything is addressed by the
 * MACHINE'S own id rather than the ssh alias.
 */
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  SERVER_PROXY_PREFIX,
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

  it("says the machine answered on any HTTP answer, refusals included", async () => {
    const port = await listen();
    const seen: [string, { ok: boolean }][] = [];
    const proxy = machinesProxy(
      async () => ({ port, cookie: "penguin_session=x" }),
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
      async () => ({ port, cookie: "penguin_session=x" }),
      (machineId, outcome) => seen.push([machineId, outcome]),
    );
    const response = await proxy(request(A));
    expect(response?.status).toBe(502);
    expect(seen).toHaveLength(1);
    expect(seen[0]![1]).toMatchObject({ ok: false });
    expect((seen[0]![1] as { detail: string }).detail).not.toBe("");
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
