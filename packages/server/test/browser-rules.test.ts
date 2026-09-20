/**
 * The Browser's rules, as pure functions: what an address means, which addresses are the
 * public internet, what is rewritten on the way through, and what the egress refuses.
 */
import { describe, expect, it } from "vitest";
import {
  browserHostOf,
  browserLabelOf,
  isPublicAddress,
  parseBrowserAddress,
  BROWSER_HOST_PATTERN,
} from "../src/browser/address.js";
import { BrowserEgress, EgressRefused, vetPublicHost } from "../src/browser/egress.js";
import {
  BOOTSTRAP_PATH,
  browserResponseHeaders,
  injectBootstrap,
  rewriteLocation,
  scriptNonce,
  upstreamRequestHeaders,
} from "../src/browser/rewrite.js";
import { mintLabel } from "../src/browser/sites.js";

const BROWSER = "http://abcdefghijklmnopqrstuvwxyz.localhost:7364";

describe("an address", () => {
  it("reads a loopback name as a port of the Workspace's machine, whatever the name", () => {
    for (const typed of [
      "localhost:3000",
      "http://127.0.0.1:3000/",
      "http://[::1]:3000",
      "app.localhost:3000",
    ]) {
      const parsed = parseBrowserAddress(typed);
      expect(parsed).toMatchObject({
        target: { kind: "workspace", origin: "http://localhost:3000", port: 3000 },
      });
    }
    expect(parseBrowserAddress("localhost")).toMatchObject({ target: { port: 80 } });
  });

  it("reads any other name as a public origin, and gives a bare one http", () => {
    expect(parseBrowserAddress("example.com/docs?q=1#top")).toMatchObject({
      target: { kind: "public", origin: "http://example.com" },
    });
    expect(parseBrowserAddress("https://example.com:8443/x")).toMatchObject({
      target: { kind: "public", origin: "https://example.com:8443" },
    });
  });

  it("refuses what is not a web address, credentials in one, and https to a Workspace port", () => {
    expect(parseBrowserAddress("")).toEqual({ refused: "invalid_url" });
    expect(parseBrowserAddress("file:///etc/passwd")).toEqual({ refused: "unsupported_scheme" });
    expect(parseBrowserAddress("javascript://x")).toEqual({ refused: "unsupported_scheme" });
    expect(parseBrowserAddress("http://user:pw@example.com")).toEqual({
      refused: "credentials_in_url",
    });
    expect(parseBrowserAddress("https://localhost:3000")).toEqual({ refused: "workspace_https" });
  });
});

describe("a Browser host", () => {
  it("is a minted label under .localhost, and nothing else is", () => {
    const label = mintLabel();
    expect(label).toMatch(/^[a-z2-7]{26}$/);
    expect(mintLabel()).not.toBe(label);
    expect(browserLabelOf(browserHostOf(label))).toBe(label);
    expect(new RegExp(BROWSER_HOST_PATTERN).test(browserHostOf(label))).toBe(true);
    for (const host of [
      "localhost",
      "127.0.0.1",
      "app.localhost",
      `${label}.example.com`,
      `x.${label}.localhost`,
    ]) {
      expect(browserLabelOf(host)).toBeNull();
      expect(new RegExp(BROWSER_HOST_PATTERN).test(host)).toBe(false);
    }
  });
});

describe("isPublicAddress", () => {
  it("refuses every address that is not the public internet", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:10.0.0.1",
      "::ffff:7f00:1",
      "64:ff9b::a00:1",
      "not-an-address",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("allows the public internet", () => {
    for (const address of [
      "93.184.216.34",
      "1.1.1.1",
      "172.32.0.1",
      "2606:2800:220:1::1",
      "::ffff:1.1.1.1",
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });
});

describe("vetPublicHost", () => {
  it("refuses a name when ANY of its addresses is not public", async () => {
    await expect(
      vetPublicHost("evil.test", async () => ["93.184.216.34", "10.0.0.5"]),
    ).rejects.toMatchObject({
      code: "not_public",
    });
    await expect(vetPublicHost("fine.test", async () => ["93.184.216.34"])).resolves.toEqual([
      "93.184.216.34",
    ]);
  });

  it("judges a literal address without resolving anything", async () => {
    const never = async (): Promise<string[]> => {
      throw new Error("resolved a literal");
    };
    await expect(vetPublicHost("169.254.169.254", never)).rejects.toBeInstanceOf(EgressRefused);
    await expect(vetPublicHost("[::1]", never)).rejects.toBeInstanceOf(EgressRefused);
    await expect(vetPublicHost("1.1.1.1", never)).resolves.toEqual(["1.1.1.1"]);
  });

  it("refuses a name that does not resolve", async () => {
    await expect(
      vetPublicHost("gone.test", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toMatchObject({ code: "unresolvable" });
  });
});

describe("the egress", () => {
  const request = () => ({
    method: "GET",
    path: "/",
    headers: new Headers(),
    body: null,
    signal: new AbortController().signal,
  });

  it("never fetches a public target whose name resolves privately — on every request, not once", async () => {
    let fetched = 0;
    let answer = ["93.184.216.34"];
    const egress = new BrowserEgress({
      dialPort: async () => ({ ok: false, detail: "unused" }),
      ownPort: () => 7364,
      proxied: () => true,
      fetch: async () => {
        fetched++;
        return new Response("ok");
      },
      resolve: async () => answer,
    });
    const target = { kind: "public", origin: "http://rebind.test" } as const;
    expect(await (await egress.fetch(target, null, request())).text()).toBe("ok");
    answer = ["127.0.0.1"]; // the rebind
    await expect(egress.fetch(target, null, request())).rejects.toMatchObject({
      code: "not_public",
    });
    expect(fetched).toBe(1);
  });

  it("asks for a manual redirect, and pins the resolution only when the connection is direct", async () => {
    const inits: Array<RequestInit & { dispatcher?: unknown }> = [];
    let proxied = true;
    const egress = new BrowserEgress({
      dialPort: async () => ({ ok: false, detail: "unused" }),
      ownPort: () => 7364,
      proxied: () => proxied,
      fetch: async (_input, init) => {
        inits.push(init ?? {});
        return new Response("ok");
      },
      resolve: async () => ["93.184.216.34"],
    });
    const target = { kind: "public", origin: "https://example.test" } as const;
    await egress.fetch(target, null, request());
    proxied = false;
    await egress.fetch(target, null, request());
    egress.close();
    expect(inits.map((init) => init.redirect)).toEqual(["manual", "manual"]);
    expect(inits[0]?.dispatcher).toBeUndefined();
    expect(inits[1]?.dispatcher).toBeDefined();
  });

  it("refuses this app's own port as a Workspace target, and a machine that is not connected", async () => {
    const egress = new BrowserEgress({
      dialPort: async () => ({ ok: false, detail: "machine not connected" }),
      ownPort: () => 7364,
      proxied: () => false,
      fetch: async () => new Response("unused"),
    });
    await expect(
      egress.fetch(
        { kind: "workspace", origin: "http://localhost:7364", port: 7364 },
        null,
        request(),
      ),
    ).rejects.toMatchObject({ code: "own_port" });
    await expect(
      egress.fetch(
        { kind: "workspace", origin: "http://localhost:3000", port: 3000 },
        "machine",
        request(),
      ),
    ).rejects.toMatchObject({ code: "machine_unreachable", message: "machine not connected" });
  });
});

describe("what is rewritten", () => {
  const target = { kind: "workspace", origin: "http://localhost:3000", port: 3000 } as const;

  it("asks the site under its own name, and tells it nothing of the app", () => {
    const out = upstreamRequestHeaders(
      new Headers({
        host: "abcdefghijklmnopqrstuvwxyz.localhost:7364",
        origin: BROWSER,
        referer: `${BROWSER}/page?x=1`,
        "accept-encoding": "gzip, br",
        connection: "keep-alive",
        cookie: "sid=1",
      }),
      target,
      BROWSER,
    );
    expect(out.get("host")).toBe("localhost:3000");
    expect(out.get("origin")).toBe("http://localhost:3000");
    expect(out.get("referer")).toBe("http://localhost:3000/page?x=1");
    expect(out.get("accept-encoding")).toBe("identity");
    expect(out.get("connection")).toBeNull();
    expect(out.get("cookie")).toBe("sid=1");

    const framed = upstreamRequestHeaders(
      new Headers({ referer: "http://localhost:7364/chat/s1" }),
      target,
      BROWSER,
    );
    expect(framed.get("referer")).toBeNull();
  });

  it("lets the page be framed, keeps its cookies on its own host, and leaks no Referer", () => {
    const upstream = new Headers({
      "x-frame-options": "DENY",
      "content-security-policy":
        "default-src 'self'; frame-ancestors 'none'; script-src 'nonce-abc123'",
      "strict-transport-security": "max-age=1",
      "content-length": "10",
    });
    upstream.append("set-cookie", "sid=1; Path=/; Domain=example.com; HttpOnly");
    upstream.append("set-cookie", "theme=dark");
    const out = browserResponseHeaders(upstream, target, BROWSER, true);
    expect(out.get("x-frame-options")).toBeNull();
    expect(out.get("strict-transport-security")).toBeNull();
    expect(out.get("content-length")).toBeNull();
    expect(out.get("content-security-policy")).toBe(
      "default-src 'self'; script-src 'nonce-abc123'",
    );
    expect(out.getSetCookie()).toEqual(["sid=1; Path=/; HttpOnly", "theme=dark"]);
    expect(out.get("referrer-policy")).toBe("no-referrer");
    expect(browserResponseHeaders(upstream, target, BROWSER, false).get("content-length")).toBe(
      "10",
    );
  });

  it("keeps a redirect to the site inside the Browser, under any loopback name, and leaves the rest alone", () => {
    expect(rewriteLocation("http://127.0.0.1:3000/login?next=%2F", target, BROWSER)).toBe(
      `${BROWSER}/login?next=%2F`,
    );
    expect(rewriteLocation("/login", target, BROWSER)).toBe("/login");
    expect(rewriteLocation("http://localhost:4000/", target, BROWSER)).toBe(
      "http://localhost:4000/",
    );
    expect(rewriteLocation("https://example.com/", target, BROWSER)).toBe("https://example.com/");
    const site = { kind: "public", origin: "https://example.com" } as const;
    expect(rewriteLocation("https://example.com/a", site, BROWSER)).toBe(`${BROWSER}/a`);
    expect(rewriteLocation("https://evil.example.com/a", site, BROWSER)).toBe(
      "https://evil.example.com/a",
    );
  });

  it("puts the bootstrap first in the document, with the page's nonce when it has one", () => {
    const tag = `<script src="${BOOTSTRAP_PATH}"></script>`;
    expect(injectBootstrap('<html><head lang="en"><title>x</title></head></html>', null)).toBe(
      `<html><head lang="en">${tag}<title>x</title></head></html>`,
    );
    expect(injectBootstrap("<html><body>x</body></html>", null)).toBe(
      `<html>${tag}<body>x</body></html>`,
    );
    expect(injectBootstrap("plain", null)).toBe(`${tag}plain`);
    expect(scriptNonce("script-src 'nonce-abc123' 'strict-dynamic'")).toBe("abc123");
    expect(scriptNonce("default-src 'self'")).toBeNull();
    expect(injectBootstrap("<head></head>", "abc123")).toContain('nonce="abc123"');
  });
});
