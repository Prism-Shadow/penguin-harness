/**
 * Unit tests for the outbound-proxy module's pure parts — the NO_PROXY loopback merge,
 * proxy-address normalization, and the dispatcher choice per settings state — plus
 * behavioral checks that an explicit address actually routes traffic through that proxy
 * while loopback stays direct, and that local destinations go direct whatever the proxy
 * settings say:
 *
 * - Given proxy variables (or an explicit address) and a proxy that tunnels whatever it is
 *   asked for, a request to a private, link-local or `.local` destination, or to a forwarded
 *   local port, never reaches the proxy, and a request to a public host does.
 * - The NO_PROXY a command is given when the explicit address is injected carries the local
 *   ranges as CIDR entries, beside the environment's own and the loopback names.
 * - Given the proxy installed for the process with an explicit address, a GET and a JSON
 *   POST handed to the global fetch as a Request built with the runtime's own Request class
 *   (how the Gemini SDK sends every call) go out through that proxy, method, path and body
 *   intact.
 * - Given the proxy installed, a settings change sends the next request through the new
 *   address, without a restart.
 */
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Agent, fetch as undiciFetch, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import {
  LocalFirstDispatcher,
  agentNoProxy,
  applyProxySettings,
  buildProxyDispatcher,
  envProxyAgentOptions,
  installGlobalProxyDispatcher,
  isLocalDestination,
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

  it("passes socks5/socks addresses through to undici", () => {
    expect(normalizeProxyUrl("socks5://proxy.corp.example:1080")).toBe(
      "socks5://proxy.corp.example:1080",
    );
    expect(normalizeProxyUrl("socks://127.0.0.1:1080")).toBe("socks://127.0.0.1:1080");
    // The parser's bare "/" is trimmed for non-special schemes too.
    expect(normalizeProxyUrl("socks5://proxy.corp.example:1080/")).toBe(
      "socks5://proxy.corp.example:1080",
    );
  });

  it("keeps credentials intact (SOCKS and proxy-authorization auth ride the URL)", () => {
    expect(normalizeProxyUrl("socks5://user:pass@proxy.corp.example:1080")).toBe(
      "socks5://user:pass@proxy.corp.example:1080",
    );
    expect(normalizeProxyUrl("http://user:pass@proxy.corp.example:8080")).toBe(
      "http://user:pass@proxy.corp.example:8080",
    );
  });

  it("rejects what undici's dispatcher cannot construct, and unparseable shapes", () => {
    // Schemes undici's ProxyAgent throws on — storing one would crash the next startup.
    expect(normalizeProxyUrl("socks4://proxy.corp.example:1080")).toBeNull();
    expect(normalizeProxyUrl("ftp://proxy.corp.example")).toBeNull();
    // Unparseable shapes.
    expect(normalizeProxyUrl("http://")).toBeNull();
    expect(normalizeProxyUrl("socks5://")).toBeNull();
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
  it("app switch off → plain Agent; on → local destinations first, with or without an explicit address", async () => {
    const off = buildProxyDispatcher({ proxyForApp: false, proxyUrl: null }, {});
    const onEnv = buildProxyDispatcher({ proxyForApp: true, proxyUrl: null }, {});
    const onExplicit = buildProxyDispatcher(
      { proxyForApp: true, proxyUrl: "http://explicit.example:3128" },
      {},
    );
    try {
      expect(off).toBeInstanceOf(Agent);
      expect(onEnv).toBeInstanceOf(LocalFirstDispatcher);
      expect(onExplicit).toBeInstanceOf(LocalFirstDispatcher);
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

  it("explicit socks5 address: traffic tunnels through the SOCKS proxy", async () => {
    // A minimal no-auth SOCKS5 server that accepts CONNECT and then plays the tunneled
    // origin itself — a request to an unresolvable name can only succeed through it.
    const targets: string[] = [];
    const proxy = net.createServer((socket) => {
      let stage: "greeting" | "request" | "tunnel" = "greeting";
      let buffered = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (stage === "greeting" && buffered.length >= 2 && buffered.length >= 2 + buffered[1]!) {
          buffered = buffered.subarray(2 + buffered[1]!);
          stage = "request";
          socket.write(Buffer.from([0x05, 0x00])); // no-auth accepted
        }
        if (stage === "request" && buffered.length >= 5 && buffered[3] === 0x03) {
          const nameLen = buffered[4]!;
          if (buffered.length < 5 + nameLen + 2) return;
          const name = buffered.subarray(5, 5 + nameLen).toString("utf8");
          const port = buffered.readUInt16BE(5 + nameLen);
          targets.push(`${name}:${port}`);
          buffered = buffered.subarray(5 + nameLen + 2);
          stage = "tunnel";
          // Success reply, bound address 0.0.0.0:0.
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        }
        if (stage === "tunnel" && buffered.toString("utf8").includes("\r\n\r\n")) {
          socket.end(
            "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 9\r\nconnection: close\r\n\r\nvia-socks",
          );
        }
      });
    });
    const proxyPort = await new Promise<number>((resolve) => {
      proxy.listen(0, "127.0.0.1", () => resolve((proxy.address() as AddressInfo).port));
    });
    const dispatcher = buildProxyDispatcher(
      { proxyForApp: true, proxyUrl: `socks5://127.0.0.1:${proxyPort}` },
      {},
    );
    try {
      const res = await undiciFetch("http://proxied.invalid/x", { dispatcher });
      expect(await res.text()).toBe("via-socks");
      expect(targets).toEqual(["proxied.invalid:80"]);
    } finally {
      await dispatcher.close();
      proxy.close();
    }
  });
});

describe("isLocalDestination", () => {
  it("takes loopback, the private ranges, link-local and local names as local", () => {
    for (const host of [
      "127.0.0.1",
      "127.12.0.9",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.124.47",
      "169.254.10.10",
      "[::1]",
      "[fd12:3456::1]",
      "[fe80::1]",
      "fe80::1%en0",
      "[::ffff:192.168.1.10]",
      "[::ffff:c0a8:10a]",
      "localhost",
      "api.localhost",
      "printer.local",
      "Printer.Local.",
    ]) {
      expect(isLocalDestination(host), host).toBe(true);
    }
  });

  it("leaves public addresses and every other name to the proxy settings", () => {
    for (const host of [
      "172.32.0.1",
      "8.8.8.8",
      "100.64.0.1",
      "[2001:db8::1]",
      "api.deepseek.com",
      "local.example.com",
      "localhost.example.com",
      "",
    ]) {
      expect(isLocalDestination(host), host).toBe(false);
    }
  });
});

describe("local destinations and the proxy", () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.unstubAllEnvs();
  });

  /**
   * A proxy that tunnels whatever it is asked for and answers as the origin, counting what it
   * was asked; a local server; and a direct dispatcher whose connector reaches that server
   * whatever address it is handed — a private address this test cannot bind still has to be
   * dialled to prove it went direct — recording the address it was asked for.
   */
  async function rig() {
    const listen = (server: net.Server) =>
      new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
      );
    const viaProxy: string[] = [];
    const proxy = http.createServer((_req, res) => res.end());
    proxy.on("connect", (req, socket) => {
      viaProxy.push(req.url ?? "");
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      let head = "";
      socket.on("data", (chunk: Buffer) => {
        head += chunk.toString("utf8");
        if (!head.includes("\r\n\r\n")) return;
        socket.end("HTTP/1.1 200 OK\r\ncontent-length: 9\r\nconnection: close\r\n\r\nvia-proxy");
      });
    });
    const local = http.createServer((_req, res) => res.end("direct"));
    const proxyPort = await listen(proxy);
    const localPort = await listen(local);
    const direct: string[] = [];
    const directAgent = new Agent({
      connect: (opts, callback) => {
        // As the connector sees them: a default port arrives empty, an IPv6 host bracketed or not.
        direct.push(`${opts.hostname.replace(/^\[|\]$/g, "")}:${opts.port || 80}`);
        const socket = net.connect({ host: "127.0.0.1", port: localPort });
        socket.once("connect", () => callback(null, socket));
        socket.once("error", (err) => callback(err, null));
      },
    });
    cleanups.push(
      () => void proxy.close(),
      () => void local.close(),
    );
    return { proxyUrl: `http://127.0.0.1:${proxyPort}`, localPort, viaProxy, direct, directAgent };
  }

  const LOCAL_URLS = [
    "http://192.168.124.47:7371/api/version",
    "http://10.0.0.5:8000/v1/models",
    "http://172.20.3.4/",
    "http://169.254.169.254/latest",
    "http://[fd00::5]:8080/",
    "http://printer.local:631/",
  ];

  for (const mode of ["the proxy variables", "an explicit proxy address"] as const) {
    it(`with ${mode}, local and private destinations go direct and a public host through the proxy`, async () => {
      const { proxyUrl, localPort, viaProxy, direct, directAgent } = await rig();
      const fromEnv = mode === "the proxy variables";
      if (fromEnv) {
        for (const name of ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"]) {
          vi.stubEnv(name, proxyUrl);
        }
        vi.stubEnv("NO_PROXY", "");
        vi.stubEnv("no_proxy", "");
      }
      const dispatcher = buildProxyDispatcher(
        { proxyForApp: true, proxyUrl: fromEnv ? null : proxyUrl },
        {},
        directAgent,
      );
      cleanups.push(() => dispatcher.close());

      for (const url of LOCAL_URLS) {
        const res = await undiciFetch(url, { dispatcher });
        expect(await res.text(), url).toBe("direct");
      }
      // A forwarded local port, the way a tunnel to a machine is reached.
      const forwarded = await undiciFetch(`http://127.0.0.1:${localPort}/api/version`, {
        dispatcher,
      });
      expect(await forwarded.text()).toBe("direct");
      expect(viaProxy).toEqual([]);
      expect(direct).toEqual([
        "192.168.124.47:7371",
        "10.0.0.5:8000",
        "172.20.3.4:80",
        "169.254.169.254:80",
        "fd00::5:8080",
        "printer.local:631",
        `127.0.0.1:${localPort}`,
      ]);

      const remote = await undiciFetch("http://models.example.com/v1/models", { dispatcher });
      expect(await remote.text()).toBe("via-proxy");
      expect(viaProxy).toEqual(["models.example.com:80"]);
    });
  }
});

describe("agentNoProxy", () => {
  it("gives a command the local ranges as CIDR entries, after the environment's own and the loopback names", () => {
    expect(agentNoProxy({ NO_PROXY: "corp.example" }).split(",")).toEqual([
      "corp.example",
      "localhost",
      "127.0.0.1",
      "::1",
      "127.0.0.0/8",
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "169.254.0.0/16",
      "fc00::/7",
      "fe80::/10",
      ".local",
    ]);
  });

  it("does not repeat a range the environment already names", () => {
    const entries = agentNoProxy({ no_proxy: "10.0.0.0/8,.LOCAL" }).split(",");
    expect(entries.filter((e) => e.toLowerCase() === "10.0.0.0/8")).toHaveLength(1);
    expect(entries.filter((e) => e.toLowerCase() === ".local")).toHaveLength(1);
  });

  it("leaves the dispatcher's own NO_PROXY as it was: undici does not read CIDR entries", () => {
    expect(envProxyAgentOptions(null, {}).noProxy).toBe("localhost,127.0.0.1,::1");
  });
});

describe("the global fetch with the proxy installed", () => {
  // One fake proxy for the block: it answers CONNECT, notes the target and the user named in
  // the address that sent it, and hands the tunnel to an origin that echoes what it received.
  const connects: Array<{ target: string; user: string }> = [];
  const origin = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json", connection: "close" });
      res.end(
        JSON.stringify({
          method: req.method,
          path: req.url,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
  });
  const proxy = http.createServer((_req, res) => res.end());
  proxy.on("connect", (req, socket, head) => {
    const auth = String(req.headers["proxy-authorization"] ?? "").replace(/^Basic /, "");
    connects.push({
      target: req.url ?? "",
      user: Buffer.from(auth, "base64").toString("utf8").split(":")[0] ?? "",
    });
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) socket.unshift(head);
    origin.emit("connection", socket);
  });
  let proxyPort = 0;
  const address = (user: string) => `http://${user}:secret@127.0.0.1:${proxyPort}`;
  const runtimeFetch = globalThis.fetch;
  const previousDispatcher = getGlobalDispatcher();

  beforeAll(async () => {
    proxyPort = await new Promise<number>((resolve) => {
      proxy.listen(0, "127.0.0.1", () => resolve((proxy.address() as AddressInfo).port));
    });
    installGlobalProxyDispatcher();
  });

  afterAll(async () => {
    // Back to what the files after this one in the worker expect: the module's default
    // settings, the dispatcher that was there before, and the runtime's fetch.
    applyProxySettings({ proxyForApp: true, proxyUrl: null });
    const installed = getGlobalDispatcher();
    setGlobalDispatcher(previousDispatcher);
    globalThis.fetch = runtimeFetch;
    await installed.close();
    proxy.close();
  });

  it.each([
    ["GET", undefined],
    ["POST", JSON.stringify({ input: "ping" })],
  ] as const)(
    "a %s Request built with the runtime's Request class goes out through the proxy",
    async (method, body) => {
      applyProxySettings({ proxyForApp: true, proxyUrl: address("first") });
      const before = connects.length;
      const request = new Request("http://models.example.com/v1beta/interactions?alt=sse", {
        method,
        ...(body !== undefined ? { body, headers: { "content-type": "application/json" } } : {}),
      });

      const res = await globalThis.fetch(request);

      expect(await res.json()).toEqual({
        method,
        path: "/v1beta/interactions?alt=sse",
        body: body ?? "",
      });
      expect(connects.slice(before)).toEqual([{ target: "models.example.com:80", user: "first" }]);
    },
  );

  it("a settings change sends the next request through the new address, without a restart", async () => {
    applyProxySettings({ proxyForApp: true, proxyUrl: address("first") });
    const before = connects.length;
    await (await globalThis.fetch("http://models.example.com/one")).text();

    applyProxySettings({ proxyForApp: true, proxyUrl: address("second") });
    await (await globalThis.fetch("http://models.example.com/two")).text();

    expect(connects.slice(before).map((c) => c.user)).toEqual(["first", "second"]);
  });
});
