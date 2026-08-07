/**
 * Unit tests for the outbound-proxy module's pure parts — the NO_PROXY loopback merge,
 * proxy-address normalization, and the dispatcher choice per settings state — plus one
 * behavioral check that an explicit address actually routes traffic through that proxy
 * while loopback stays direct. No global install — installGlobalProxyDispatcher (fetch
 * replacement) runs only in the production entry.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import {
  buildProxyDispatcher,
  envProxyAgentOptions,
  mergedNoProxy,
  normalizeProxyUrl,
} from "../src/net/proxy.js";

describe("mergedNoProxy", () => {
  it("yields exactly the loopback names when the environment has no NO_PROXY", () => {
    expect(mergedNoProxy({})).toBe("localhost,127.0.0.1,::1");
  });

  it("appends the loopback names after the environment's entries", () => {
    expect(mergedNoProxy({ NO_PROXY: "example.com,.corp.internal" })).toBe(
      "example.com,.corp.internal,localhost,127.0.0.1,::1",
    );
  });

  it("prefers the lowercase spelling, like undici itself", () => {
    expect(mergedNoProxy({ no_proxy: "a.example", NO_PROXY: "b.example" })).toBe(
      "a.example,localhost,127.0.0.1,::1",
    );
  });

  it("does not duplicate loopback names already present (case-insensitively)", () => {
    expect(mergedNoProxy({ NO_PROXY: "LOCALHOST,::1" })).toBe("LOCALHOST,::1,127.0.0.1");
  });

  it("survives messy separators (comma/whitespace mix, empty segments)", () => {
    expect(mergedNoProxy({ NO_PROXY: " example.com ,, other.example " })).toBe(
      "example.com,other.example,localhost,127.0.0.1,::1",
    );
  });
});

describe("normalizeProxyUrl", () => {
  it("passes canonical http/https addresses through", () => {
    expect(normalizeProxyUrl("http://proxy.corp.example:8080")).toBe(
      "http://proxy.corp.example:8080",
    );
    expect(normalizeProxyUrl("https://proxy.corp.example:3128")).toBe(
      "https://proxy.corp.example:3128",
    );
    expect(normalizeProxyUrl("http://proxy.corp.example")).toBe("http://proxy.corp.example");
  });

  it("normalizes the bare host[:port] shorthand to http://", () => {
    expect(normalizeProxyUrl("proxy.corp.example:8080")).toBe("http://proxy.corp.example:8080");
    expect(normalizeProxyUrl("proxy.corp.example")).toBe("http://proxy.corp.example");
    expect(normalizeProxyUrl("127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
  });

  it("canonicalizes case, surrounding whitespace, trailing slash, and default ports", () => {
    expect(normalizeProxyUrl("  http://proxy.corp.example:8080  ")).toBe(
      "http://proxy.corp.example:8080",
    );
    expect(normalizeProxyUrl("HTTP://PROXY.CORP.EXAMPLE:8080")).toBe(
      "http://proxy.corp.example:8080",
    );
    expect(normalizeProxyUrl("http://proxy.corp.example:8080/")).toBe(
      "http://proxy.corp.example:8080",
    );
    // URL's canonical form drops a scheme-default port; the connection is identical.
    expect(normalizeProxyUrl("http://proxy.corp.example:80")).toBe("http://proxy.corp.example");
  });

  it("keeps IPv6 literals bracketed", () => {
    expect(normalizeProxyUrl("http://[::1]:8080")).toBe("http://[::1]:8080");
  });

  it("rejects everything that is not an http(s) host[:port]", () => {
    // Other schemes: the dispatcher speaks only HTTP(S) proxies.
    expect(normalizeProxyUrl("socks5://proxy.corp.example:1080")).toBeNull();
    expect(normalizeProxyUrl("ftp://proxy.corp.example")).toBeNull();
    // Credentials, paths, queries, fragments: a proxy address is host-only.
    expect(normalizeProxyUrl("http://user:pass@proxy.corp.example:8080")).toBeNull();
    expect(normalizeProxyUrl("http://proxy.corp.example:8080/path")).toBeNull();
    expect(normalizeProxyUrl("http://proxy.corp.example:8080?x=1")).toBeNull();
    expect(normalizeProxyUrl("http://proxy.corp.example:8080#frag")).toBeNull();
    // Unparseable shapes.
    expect(normalizeProxyUrl("http://")).toBeNull();
    expect(normalizeProxyUrl("not a proxy")).toBeNull();
    expect(normalizeProxyUrl("proxy.corp.example:port")).toBeNull();
    expect(normalizeProxyUrl("")).toBeNull();
    expect(normalizeProxyUrl("   ")).toBeNull();
  });
});

describe("envProxyAgentOptions", () => {
  it("without an explicit address: only the merged NO_PROXY (env drives the proxies)", () => {
    expect(envProxyAgentOptions(null, { NO_PROXY: "corp.example" })).toEqual({
      noProxy: "corp.example,localhost,127.0.0.1,::1",
    });
  });

  it("with an explicit address: both httpProxy and httpsProxy pinned to it, NO_PROXY still merged", () => {
    // httpProxy/httpsProxy take precedence over the environment inside undici's
    // EnvHttpProxyAgent (its constructor reads `httpProxy ?? env...`), so the ambient
    // variables in `env` must not leak into the options this module assembles.
    expect(
      envProxyAgentOptions("http://explicit.example:3128", {
        HTTP_PROXY: "http://ambient.example:8080",
        NO_PROXY: "corp.example",
      }),
    ).toEqual({
      httpProxy: "http://explicit.example:3128",
      httpsProxy: "http://explicit.example:3128",
      noProxy: "corp.example,localhost,127.0.0.1,::1",
    });
  });
});

describe("buildProxyDispatcher", () => {
  it("app switch off → plain Agent; on → EnvHttpProxyAgent, with or without an explicit address", async () => {
    const off = buildProxyDispatcher({ proxyForApp: false, proxyUrl: null }, {});
    const onEnv = buildProxyDispatcher({ proxyForApp: true, proxyUrl: null }, {});
    const onExplicit = buildProxyDispatcher(
      { proxyForApp: true, proxyUrl: "http://explicit.example:3128" },
      {},
    );
    try {
      expect(off).toBeInstanceOf(Agent);
      expect(off).not.toBeInstanceOf(EnvHttpProxyAgent);
      expect(onEnv).toBeInstanceOf(EnvHttpProxyAgent);
      expect(onExplicit).toBeInstanceOf(EnvHttpProxyAgent);
    } finally {
      await off.close();
      await onEnv.close();
      await onExplicit.close();
    }
  });

  it("explicit address: traffic tunnels through that proxy, loopback bypasses it", async () => {
    // The fake proxy answers CONNECT and then plays the tunneled origin itself, so a
    // request to an unresolvable name can only succeed by traveling through the proxy.
    const connects: string[] = [];
    const proxy = http.createServer((_req, res) => res.end());
    proxy.on("connect", (req, socket) => {
      connects.push(req.url ?? "");
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      let buffered = "";
      socket.on("data", (chunk: Buffer) => {
        buffered += chunk.toString("utf8");
        if (!buffered.includes("\r\n\r\n")) return; // wait for the full tunneled request head
        socket.end(
          "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 9\r\nconnection: close\r\n\r\nvia-proxy",
        );
      });
    });
    const direct = http.createServer((_req, res) => res.end("direct"));
    const listen = (server: http.Server) =>
      new Promise<number>((resolve) => {
        // No hostname: dual-stack, so the localhost fetch below works whether the
        // resolver picks ::1 or 127.0.0.1 first.
        server.listen(0, () => resolve((server.address() as AddressInfo).port));
      });
    const proxyPort = await listen(proxy);
    const directPort = await listen(direct);
    // Empty env: no proxy variables — reaching the fake proxy proves the explicit URL
    // is honored on its own, and the loopback exemption proves the merge alone (not an
    // ambient NO_PROXY) produced it.
    const dispatcher = buildProxyDispatcher(
      { proxyForApp: true, proxyUrl: `http://127.0.0.1:${proxyPort}` },
      {},
    );
    try {
      const viaProxy = await undiciFetch("http://proxied.invalid/x", { dispatcher });
      expect(await viaProxy.text()).toBe("via-proxy");
      expect(connects).toEqual(["proxied.invalid:80"]);
      const directRes = await undiciFetch(`http://localhost:${directPort}/`, { dispatcher });
      expect(await directRes.text()).toBe("direct");
      expect(connects).toHaveLength(1); // the loopback request never touched the proxy
    } finally {
      await dispatcher.close();
      proxy.close();
      direct.close();
    }
  });
});
