/**
 * The Browser end to end, through the App: minting a site, what a Browser host serves, and
 * above all what it does NOT — the App, to a page that is not the App's.
 *
 * The upstream is a real HTTP server on this process's loopback, reached the way a Workspace
 * port on this server is reached.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrowserSiteResponse } from "../src/api/types.js";
import { BOOTSTRAP_PATH } from "../src/browser/rewrite.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("the Browser", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let adminCookie: string;
  let upstream: http.Server;
  let port: number;
  /** What the upstream was asked, so a test can see what reached it. */
  let asked: Array<{
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }>;
  const publicFetches: string[] = [];

  beforeEach(async () => {
    asked = [];
    publicFetches.length = 0;
    upstream = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        asked.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
        if (req.url === "/redirect") {
          res.writeHead(302, { location: `http://127.0.0.1:${port}/landed` }).end();
        } else if (req.url === "/api/me") {
          res.writeHead(200, { "content-type": "application/json" }).end('{"upstream":true}');
        } else if (req.url === "/style.css") {
          res.writeHead(200, { "content-type": "text/css" }).end("body{}");
        } else {
          res
            .writeHead(200, {
              "content-type": "text/html; charset=utf-8",
              "x-frame-options": "DENY",
              "set-cookie": "sid=1; Domain=example.com; Path=/",
            })
            .end("<html><head><title>site</title></head><body>hello</body></html>");
        }
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    port = (upstream.address() as AddressInfo).port;
    t = await createTestApp({
      fetch: async (input) => {
        publicFetches.push(input);
        return new Response("<html><head></head><body>public</body></html>", {
          headers: { "content-type": "text/html" },
        });
      },
    });
    adminCookie = (await loginAdmin(t.app)).cookie;
    admin = apiClient(t.app, adminCookie);
  });

  afterEach(async () => {
    await t.cleanup();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  const mint = async (
    url: string,
    machineId: string | null = null,
  ): Promise<BrowserSiteResponse> => {
    const res = await admin.post("/api/browser/sites", { machineId, url });
    expect(res.status).toBe(200);
    return (await res.json()) as BrowserSiteResponse;
  };

  it("mints one host per origin, stable across asks, and keeps the typed path", async () => {
    const site = await mint(`localhost:${port}/docs?q=1#top`);
    expect(site.origin).toMatch(/^http:\/\/[a-z2-7]{26}\.localhost:\d+$/);
    expect(site.url).toBe(`${site.origin}/docs?q=1#top`);
    expect(site.address).toBe(`http://localhost:${port}/docs?q=1#top`);
    // 127.0.0.1 is the same Workspace port under another name: the same site.
    expect((await mint(`http://127.0.0.1:${port}/`)).origin).toBe(site.origin);
    expect((await mint(`localhost:${port + 1}`)).origin).not.toBe(site.origin);
  });

  it("serves the site on its host: the page with the bootstrap, framed, its cookie host-only", async () => {
    const site = await mint(`localhost:${port}`);
    const page = await t.app.request(`${site.origin}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(
      `<html><head><script src="${BOOTSTRAP_PATH}"></script><title>site</title></head><body>hello</body></html>`,
    );
    expect(page.headers.get("x-frame-options")).toBeNull();
    expect(page.headers.getSetCookie()).toEqual([
      "sid=1; Path=/; SameSite=None; Secure; Partitioned",
    ]);
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(asked[0]?.headers.host).toBe(`localhost:${port}`);

    const css = await t.app.request(`${site.origin}/style.css`);
    expect(await css.text()).toBe("body{}");

    const script = await t.app.request(`${site.origin}${BOOTSTRAP_PATH}`);
    expect(script.headers.get("content-type")).toContain("text/javascript");
    const source = await script.text();
    expect(source).toContain("penguin:browser:theme");
    expect(source).toContain(`"port":"${port}"`);
  });

  it("keeps a redirect to the site inside its host", async () => {
    const site = await mint(`localhost:${port}`);
    const res = await t.app.request(`${site.origin}/redirect`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${site.origin}/landed`);
  });

  it("never serves the App on a Browser host — not its API, not with its cookie, not its sign-in", async () => {
    const site = await mint(`localhost:${port}`);
    // The same path on the App answers as the App...
    expect(((await (await admin.get("/api/me")).json()) as { user?: unknown }).user).toBeDefined();
    // ...and on the Browser host it is the SITE's path, even with the App's cookie attached.
    const res = await t.app.request(`${site.origin}/api/me`, { headers: { cookie: adminCookie } });
    expect(await res.json()).toEqual({ upstream: true });

    // A write the App's own rules would refuse (a form post) is the site's business there.
    const form = await t.app.request(`${site.origin}/submit`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    expect(form.status).toBe(200);
    expect(asked.at(-1)).toMatchObject({ method: "POST", url: "/submit", body: "a=1" });

    // And a label nobody minted is nothing at all — not the App's shell either.
    const unknown = await t.app.request("http://aaaaaaaaaaaaaaaaaaaaaaaaaa.localhost/", {
      headers: { cookie: adminCookie },
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("Not found");
  });

  it("fetches a public address through the server's outbound fetch, and refuses a private one at the door", async () => {
    const site = await mint("http://93.184.216.34/page");
    const page = await t.app.request(site.url);
    expect(await page.text()).toContain("public");
    expect(publicFetches).toEqual(["http://93.184.216.34/page"]);

    for (const url of [
      "http://10.0.0.5/",
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.1.1/",
    ]) {
      const inner = await mint(url);
      const refused = await t.app.request(inner.url);
      expect(refused.status).toBe(502);
      expect(await refused.text()).toContain("not a public address");
    }
    expect(publicFetches).toHaveLength(1);
  });

  it("refuses an address it does not open, a machine it does not know, and an app not on localhost", async () => {
    const bad = await admin.post("/api/browser/sites", {
      machineId: null,
      url: "file:///etc/passwd",
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe(
      "unsupported_scheme",
    );

    expect(
      (await admin.post("/api/browser/sites", { machineId: "nobody", url: "localhost:3000" }))
        .status,
    ).toBe(404);

    const elsewhere = await t.app.request("http://192.168.1.20:7364/api/browser/sites", {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ machineId: null, url: "localhost:3000" }),
    });
    expect(elsewhere.status).toBe(409);
    expect(((await elsewhere.json()) as { error: { code: string } }).error.code).toBe(
      "browser_unavailable",
    );
  });

  it("is any signed-in user's for this server and the public internet, an admin's for a machine", async () => {
    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    expect(
      (await member.post("/api/browser/sites", { machineId: null, url: `localhost:${port}` }))
        .status,
    ).toBe(200);
    expect(
      (await member.post("/api/browser/sites", { machineId: "any", url: "localhost:3000" })).status,
    ).toBe(403);
    // A public address names no machine, so the machine a conversation is on does not gate it.
    expect(
      (await member.post("/api/browser/sites", { machineId: "any", url: "example.com" })).status,
    ).toBe(200);
    expect((await t.app.request("/api/browser/sites", { method: "POST" })).status).toBe(401);
  });

  it("gives each user a host of their own for the same origin", async () => {
    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    const mine = await mint(`localhost:${port}`);
    const theirs = (await (
      await member.post("/api/browser/sites", { machineId: null, url: `localhost:${port}` })
    ).json()) as BrowserSiteResponse;
    expect(theirs.origin).not.toBe(mine.origin);
  });
});
