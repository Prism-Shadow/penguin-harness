/**
 * What a plugin index source says when it cannot be listed, and that the published index's own
 * rows list.
 *
 * - A row carrying an npm channel (the registry, no address) beside its github channel parses,
 *   lists, and installs from the github channel; so does a row whose channel is of a kind this
 *   server does not install from. A github channel without its address is still malformed.
 * - A malformed row's failure names the document, the row's position, the package it claims to
 *   be and the field at fault.
 * - A transport failure names what lay under undici's "fetch failed": the errno, the code a
 *   message left out, each address of a host that resolved to several.
 * - A source walked over several addresses reports every address's failure, in order.
 * - Over the wire (a loopback server, the real fetch): the listing route lists the published
 *   shape with no failure, names the malformed row of a broken one, and a refused connection
 *   says it was refused.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginIndexResponse } from "../src/api/types.js";
import { fetchFailureText } from "../src/net/fetch-error.js";
import {
  httpPluginRegistry,
  indexChannelOf,
  parsePluginIndex,
  type IndexDocumentEntry,
} from "../src/plugin/registry.js";
import { pluginRegistryRoutes } from "../src/http/routes/plugins.js";
import { fakeFetch, jsonResponse } from "./fixtures/fetch.js";

const INTEGRITY = `sha512-${"A".repeat(86)}==`;
const RELEASE = "https://github.com/example/apps/releases/download/v1/demo-1.0.0.tgz";

/** A row as the published index writes one for a package also on npm. */
const PUBLISHED_ROW = {
  name: "@example/penguin-plugin-demo",
  version: "1.0.0",
  description: "A demo plugin.",
  authors: ["Example <https://example.com>"],
  license: "MIT",
  title: "Demo",
  keywords: ["demo"],
  categories: ["other"],
  updatedAt: 1795600000,
  readme: "https://index.example/assets/@example/penguin-plugin-demo/1.0.0/README.md",
  integrity: INTEGRITY,
  channels: [{ kind: "github", url: RELEASE }, { kind: "npm" }],
};

const noWait = () => Promise.resolve();

describe("the published index's rows", () => {
  it("a row that also lists its npm channel parses as written, and installs from its github channel", () => {
    const [row] = parsePluginIndex([PUBLISHED_ROW], "published");
    expect(row).toEqual(PUBLISHED_ROW);
    expect(indexChannelOf(row!)).toEqual({
      channel: {
        name: PUBLISHED_ROW.name,
        version: PUBLISHED_ROW.version,
        integrity: INTEGRITY,
        url: RELEASE,
      },
      fault: null,
    });
  });

  it("a channel of a kind this server does not install from lists as written", () => {
    const row = { ...PUBLISHED_ROW, channels: [{ kind: "vendor-mirror" }] };
    expect(parsePluginIndex([row], "published")).toEqual([row]);
    expect(indexChannelOf(parsePluginIndex([row], "published")[0]!)).toEqual({
      channel: null,
      fault: null,
    });
  });

  it("names the document, the position, the package and the field of a malformed row", () => {
    for (const [channels, fault] of [
      [[{ kind: "github" }], "channels[0] (github) has no url"],
      [
        [
          { kind: "github", url: RELEASE },
          { kind: "npm", url: 7 },
        ],
        `channels[1] (npm) has a "url" that is not a string`,
      ],
      [[{ url: RELEASE }], `channels[0] has no "kind"`],
      [[null], "channels[0] is not an object"],
      ["github", `"channels" is not a list`],
    ] as const) {
      expect(() =>
        parsePluginIndex(
          [PUBLISHED_ROW, { ...PUBLISHED_ROW, channels }],
          "https://index.example/index.json",
        ),
      ).toThrow(
        `plugin index from https://index.example/index.json has a malformed entry at index 1 (@example/penguin-plugin-demo@1.0.0): ${fault}`,
      );
    }
    const { version: _dropped, ...versionless } = PUBLISHED_ROW;
    expect(() => parsePluginIndex([versionless], "published")).toThrow(
      `plugin index from published has a malformed entry at index 0 (@example/penguin-plugin-demo): has no "version"`,
    );
    expect(() => parsePluginIndex([["not", "a", "row"]], "published")).toThrow(
      "plugin index from published has a malformed entry at index 0: is not an object",
    );
  });
});

describe("a transport failure's words", () => {
  it("keeps what lay under undici's bare 'fetch failed'", () => {
    const errno = (message: string, code: string) => Object.assign(new Error(message), { code });
    expect(
      fetchFailureText(
        new TypeError("fetch failed", {
          cause: errno("getaddrinfo ENOTFOUND index.example", "ENOTFOUND"),
        }),
      ),
    ).toBe("fetch failed (getaddrinfo ENOTFOUND index.example)");
    // A cause that says nothing but its code is named by the code.
    expect(
      fetchFailureText(new TypeError("fetch failed", { cause: errno("", "ECONNRESET") })),
    ).toBe("fetch failed (ECONNRESET)");
    // A certificate refusal's message does not carry its code; the code is kept beside it.
    expect(
      fetchFailureText(
        new TypeError("fetch failed", {
          cause: errno("unable to verify the first certificate", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"),
        }),
      ),
    ).toBe(
      "fetch failed (unable to verify the first certificate [UNABLE_TO_VERIFY_LEAF_SIGNATURE])",
    );
    // A host with several addresses, each tried: an AggregateError with no message of its own.
    expect(
      fetchFailureText(
        new TypeError("fetch failed", {
          cause: Object.assign(
            new AggregateError(
              [
                errno("connect ETIMEDOUT 192.0.2.1:443", "ETIMEDOUT"),
                errno("connect ENETUNREACH 2001:db8::1:443", "ENETUNREACH"),
              ],
              "",
            ),
            { code: "ETIMEDOUT" },
          ),
        }),
      ),
    ).toBe("fetch failed (connect ETIMEDOUT 192.0.2.1:443; connect ENETUNREACH 2001:db8::1:443)");
    // The timeout the read itself sets has no cause; its own words stand.
    expect(
      fetchFailureText(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      ),
    ).toBe("The operation was aborted due to timeout");
  });

  it("a source walked over several addresses names every address's failure, in the order tried", async () => {
    const url = "https://index.example/index.json";
    const mirror = "https://cdn-mirror.example/index.json";
    const walk = fakeFetch((call) => {
      if (call.url === url)
        return jsonResponse([{ ...PUBLISHED_ROW, channels: [{ kind: "github" }] }]);
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED 192.0.2.7:443"), {
          code: "ECONNREFUSED",
        }),
      });
    });
    await expect(
      httpPluginRegistry([url, mirror], {
        fetchImpl: walk.fetch,
        attempts: 1,
        delay: noWait,
      }).index(),
    ).rejects.toThrow(
      `plugin index from ${url} has a malformed entry at index 0 (@example/penguin-plugin-demo@1.0.0): channels[0] (github) has no url; ` +
        `plugin index from ${mirror} could not be fetched (1 attempts): fetch failed (connect ECONNREFUSED 192.0.2.7:443)`,
    );
  });
});

describe("over the wire", () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((resolve) =>
      server === null ? resolve() : server.close(() => resolve()),
    );
    server = null;
  });

  /** Serves `body` as the index document on a loopback port; resolves to its URL. */
  const serve = async (body: unknown): Promise<string> => {
    server = createServer((_req, res) => {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/index.json`;
  };

  /** The listing once the source has answered: the route never waits on the network itself. */
  const settledListing = async (url: string): Promise<PluginIndexResponse> => {
    const routes = pluginRegistryRoutes({ indexUrl: () => [url], fetchImpl: fetch });
    for (let read = 0; read < 100; read += 1) {
      const body = (await (await routes.request("/")).json()) as PluginIndexResponse;
      if ((body.pending ?? []).length === 0) return body;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("the source never answered");
  };

  it("the published index's shape lists, with no source reported down", async () => {
    const body = await settledListing(await serve([PUBLISHED_ROW]));
    expect(body.failures).toEqual([]);
    expect(body.plugins.some((e) => e.name === PUBLISHED_ROW.name)).toBe(true);
  });

  it("a broken document is reported with the row and field at fault", async () => {
    const url = await serve([PUBLISHED_ROW, { ...PUBLISHED_ROW, channels: [{ kind: "github" }] }]);
    const body = await settledListing(url);
    expect(body.failures).toEqual([
      {
        source: url,
        error: `plugin index from ${url} has a malformed entry at index 1 (@example/penguin-plugin-demo@1.0.0): channels[0] (github) has no url`,
      },
    ]);
  });

  it("a refused connection says it was refused, not just that the fetch failed", async () => {
    const url = await serve([]);
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    await expect(
      httpPluginRegistry(url, { fetchImpl: fetch, attempts: 1, delay: noWait }).index(),
    ).rejects.toThrow(
      /could not be fetched \(1 attempts\): fetch failed \(.*ECONNREFUSED 127\.0\.0\.1:\d+/,
    );
  });
});
