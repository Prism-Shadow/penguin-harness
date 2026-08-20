/**
 * The same-origin server proxy: the path/cookie/location rewrites as pure functions, and
 * the forwarding itself against a real local HTTP "remote" — method, path, query, body,
 * cookie renaming in both directions, and the not-connected answer.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cookieMarker,
  machinesProxy,
  parseProxyPath,
  rewriteLocation,
  rewriteRequestCookies,
  rewriteSetCookie,
} from "../src/machines/proxy.js";

describe("parseProxyPath", () => {
  it("reads /server/<id>/api/… and decodes the id", () => {
    expect(parseProxyPath("/server/gpu-01/api/me")).toEqual({
      id: "gpu-01",
      remotePath: "/api/me",
    });
    expect(parseProxyPath("/server/a%20b/api/sessions/x/stream")).toEqual({
      id: "a b",
      remotePath: "/api/sessions/x/stream",
    });
  });

  it("forwards ONLY /api/ paths — the frontend is deliberately local", () => {
    expect(parseProxyPath("/server/gpu-01/login")).toBeNull();
    expect(parseProxyPath("/server/gpu-01/apix")).toBeNull();
    expect(parseProxyPath("/server//api/me")).toBeNull();
    expect(parseProxyPath("/api/me")).toBeNull();
    expect(parseProxyPath("/server/gpu-01")).toBeNull();
  });
});

describe("cookie rewrites", () => {
  const id = "gpu-01";
  const marker = cookieMarker(id);

  it("forwards only this machine's cookies, renamed back — locals never leak", () => {
    const header = [
      "penguin_session=LOCAL",
      `${marker}penguin_session=REMOTE`,
      `${cookieMarker("other")}penguin_session=OTHER`,
      `${marker}penguin_parked_sessions=JAR`,
    ].join("; ");
    expect(rewriteRequestCookies(header, id)).toBe(
      "penguin_session=REMOTE; penguin_parked_sessions=JAR",
    );
    expect(rewriteRequestCookies("penguin_session=LOCAL", id)).toBeNull();
    expect(rewriteRequestCookies(null, id)).toBeNull();
  });

  it("namespaces a Set-Cookie from the remote under this machine", () => {
    expect(rewriteSetCookie("penguin_session=abc; Path=/; HttpOnly", id)).toBe(
      `${marker}penguin_session=abc; Path=/; HttpOnly`,
    );
  });

  it("re-roots an absolute-path Location under the proxy prefix", () => {
    expect(rewriteLocation("/api/me", id)).toBe("/server/gpu-01/api/me");
    expect(rewriteLocation("https://example.com/x", id)).toBe("https://example.com/x");
  });
});

describe("machinesProxy (real upstream)", () => {
  let upstream: http.Server;
  let port: number;

  beforeEach(async () => {
    upstream = http.createServer((req, res) => {
      if (req.url?.startsWith("/api/echo")) {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += String(chunk)));
        req.on("end", () => {
          res.setHeader("set-cookie", ["penguin_session=abc; Path=/; HttpOnly"]);
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              method: req.method,
              url: req.url,
              host: req.headers.host,
              cookie: req.headers.cookie ?? null,
              body,
            }),
          );
        });
        return;
      }
      if (req.url === "/api/redirect") {
        res.statusCode = 302;
        res.setHeader("location", "/api/after");
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    port = (upstream.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise((resolve) => upstream.close(resolve));
  });

  const proxy = (portFor: number | null) => machinesProxy(() => Promise.resolve(portFor));

  it("forwards method, path, query and body; renames cookies both ways", async () => {
    const marker = cookieMarker("box");
    const res = await proxy(port)(
      new Request("http://localhost:7376/server/box/api/echo?x=1", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `penguin_session=LOCAL; ${marker}penguin_session=REMOTE`,
        },
        body: '{"hello":true}',
      }),
    );
    expect(res?.status).toBe(200);
    const echoed = (await res!.json()) as Record<string, unknown>;
    expect(echoed.method).toBe("POST");
    expect(echoed.url).toBe("/api/echo?x=1");
    // The canonical app host, whatever the incoming Host was.
    expect(echoed.host).toBe(`localhost:${port}`);
    // Only the machine's own cookie went over, under its real name.
    expect(echoed.cookie).toBe("penguin_session=REMOTE");
    expect(echoed.body).toBe('{"hello":true}');
    // The remote's cookie came back namespaced for this machine.
    expect(res!.headers.get("set-cookie")).toContain(`${marker}penguin_session=abc`);
  });

  it("re-roots redirects under the proxy prefix", async () => {
    const res = await proxy(port)(
      new Request("http://localhost:7376/server/box/api/redirect", { redirect: "manual" }),
    );
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe("/server/box/api/after");
  });

  it("answers 503 not_connected when the machine has no live tunnel", async () => {
    const res = await proxy(null)(new Request("http://localhost:7376/server/box/api/me"));
    expect(res?.status).toBe(503);
    expect(((await res!.json()) as { error: { code: string } }).error.code).toBe("not_connected");
  });

  it("declines paths outside the prefix so the runtime serves them", async () => {
    await expect(proxy(port)(new Request("http://localhost:7376/api/me"))).resolves.toBeNull();
  });
});
