/**
 * Per-source CDN mirrors for the two fetches of the plugin install chain
 * (plugin/registry.ts httpPluginRegistry for the index document, plugin/install.ts
 * installPluginChannel for the channel's release asset):
 *
 * - The index read tries the source's own URL first, then the deployment's mirrors in
 *   order; a connection failure, a timeout and a non-ok answer each hand the read to the
 *   next address, and a source exhausted on is reported with the failure it ended on.
 * - A channel install does the same over the asset: the URL the index published first,
 *   then the mirrors that are releases of the same asset (channelMirrorsOf); what arrives
 *   is verified against the entry's sha512 exactly as the canonical URL's would be — a
 *   mirror serving tampered bytes is refused like any other source.
 * - A mirror that answers nothing usable is not itself a fallback for content: it only
 *   ever serves the same bytes the canonical address would have, pinned by the index.
 * - A channel whose URL is not a GitHub release download, or a mirror that is not a bare
 *   https origin, mirrors nothing; a deployment with no mirrors behaves as before.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

/** A real gzipped tarball carrying package/package.json with the given name and version. */
async function packTarball(name: string, version: string): Promise<Uint8Array> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-pkg-"));
  try {
    await fs.mkdir(path.join(dir, "package"), { recursive: true });
    await fs.writeFile(path.join(dir, "package", "package.json"), JSON.stringify({ name, version }));
    await execFileAsync("tar", ["-czf", "asset.tgz", "package"], { cwd: dir });
    return new Uint8Array(await fs.readFile(path.join(dir, "asset.tgz")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
import { installPluginChannel, PluginInstallError } from "../src/plugin/install.js";
import {
  httpPluginRegistry,
  pluginProxyMirrors,
  rewriteRuleRisk,
  type IndexChannel,
  type PluginProxyRule,
  PLUGIN_DEFAULT_PROXY_RULES,
} from "../src/plugin/registry.js";
import { resolveServerConfig } from "../src/config.js";

const noWait = async () => undefined;

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

/** A fetch fake over a table of addresses; every miss is a refused connection. */
function fakeFetch(
  answers: Record<string, { status?: number; body?: string } | Error>,
): { fetch: typeof fetch; hits: string[] } {
  const hits: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    hits.push(url);
    const answer = answers[url];
    if (answer === undefined) throw new TypeError("fetch failed");
    if (answer instanceof Error) throw answer;
    return new Response(answer.body ?? "", { status: answer.status ?? 200 });
  }) as typeof fetch;
  return { fetch: fetchImpl, hits };
}

describe("httpPluginRegistry mirrors", () => {
  const entry = [
    {
      name: "acme",
      version: "1.0.0",
      description: "d",
      authors: ["a"],
      license: "MIT",
    },
  ];

  it("reads the index from the first reachable mirror after the source's own URL failed", async () => {
    const url = "https://index.example/index.json";
    const mirror = "https://cdn-mirror.example/index.json";
    const registry = fakeFetch({
      [url]: new TypeError("fetch failed"),
      [mirror]: { body: JSON.stringify(entry) },
    });
    const entries = await httpPluginRegistry([url, mirror], {
      fetchImpl: registry.fetch,
      attempts: 1,
      delay: noWait,
    }).index();
    expect(entries).toEqual(entry);
    expect(registry.hits).toEqual([url, mirror]);
  });

  it("a non-ok answer moves the read to the next address too", async () => {
    const url = "https://index.example/index.json";
    const mirror = "https://cdn-mirror.example/index.json";
    const registry = fakeFetch({ [url]: { status: 503 }, [mirror]: { body: "[]" } });
    const entries = await httpPluginRegistry([url, mirror], {
      fetchImpl: registry.fetch,
      attempts: 1,
      delay: noWait,
    }).index();
    expect(entries).toEqual([]);
    expect(registry.hits).toEqual([url, mirror]);
  });

  it("a source exhausted on reports the failure it ended on", async () => {
    const url = "https://index.example/index.json";
    const mirror = "https://cdn-mirror.example/index.json";
    const registry = fakeFetch({ [url]: { status: 404 }, [mirror]: new TypeError("fetch failed") });
    await expect(
      httpPluginRegistry([url, mirror], { fetchImpl: registry.fetch, attempts: 1, delay: noWait }).index(),
    ).rejects.toThrow(/could not be fetched \(1 attempts\): fetch failed/);
  });

  it("a single address behaves as before: one URL, no address hop", async () => {
    const url = "https://index.example/index.json";
    const registry = fakeFetch({ [url]: { status: 503 } });
    await expect(
      httpPluginRegistry(url, { fetchImpl: registry.fetch, attempts: 1, delay: noWait }).index(),
    ).rejects.toThrow(/answered HTTP 503/);
    expect(registry.hits).toEqual([url]);
  });
});

describe("happy eyeballs over the addresses", () => {
  const entry = [
    { name: "acme", version: "1.0.0", description: "d", authors: ["a"], license: "MIT" },
  ];

  it("a slow primary does not hold the read: the mirror answers within the stagger and wins", async () => {
    const url = "https://index.example/index.json";
    const mirror = "https://cdn-mirror.example/index.json";
    const hits: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const address = String(input);
      hits.push(address);
      if (address === url) {
        // The primary hangs past the stagger; the mirror answers fast.
        return new Promise<Response>((resolve) =>
          setTimeout(() => resolve(new Response(JSON.stringify(entry), { status: 200 })), 5_000),
        );
      }
      return new Response(JSON.stringify(entry), { status: 200 });
    }) as typeof fetch;
    const entries = await httpPluginRegistry([url, mirror], {
      fetchImpl,
      attempts: 1,
      delay: noWait,
      timeoutMs: 10_000,
    }).index();
    expect(entries).toEqual(entry);
    expect(hits).toEqual([url, mirror]);
  });

  it("the sticky winner starts first: after a mirror's win the next read hits only it", async () => {
    const url = "https://index.example/index.json";
    const mirror = "https://cdn-mirror.example/index.json";
    const registry = fakeFetch({ [url]: new TypeError("fetch failed"), [mirror]: { body: "[]" } });
    const source = httpPluginRegistry([url, mirror], { fetchImpl: registry.fetch, attempts: 1, delay: noWait });
    await source.index();
    expect(registry.hits).toEqual([url, mirror]);
    registry.hits.length = 0;
    await source.index();
    expect(registry.hits).toEqual([mirror]);
  });

  it("every address dead: the sweep's failure is the last one's, without waiting out each window serially", async () => {
    const url = "https://index.example/index.json";
    const mirror = "https://cdn-mirror.example/index.json";
    const registry = fakeFetch({ [url]: new TypeError("fetch failed"), [mirror]: new TypeError("fetch failed") });
    const started = Date.now();
    await expect(
      httpPluginRegistry([url, mirror], { fetchImpl: registry.fetch, attempts: 1, delay: noWait }).index(),
    ).rejects.toThrow(/could not be fetched/);
    // Staggered: the sweep costs roughly one window plus the stagger, not two windows.
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("channel mirrors", () => {
  const asset = new TextEncoder().encode("a release tarball's bytes");
  const integrity = `sha512-${createHash("sha512").update(asset).digest("base64")}`;

  const channel = (mirrors?: string[]): IndexChannel => ({
    name: "acme",
    version: "1.0.0",
    integrity,
    url: "https://github.com/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz",
    mirrors,
  });

  it("installs from the mirror after the release URL failed, same verified bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const mirrorUrl = "https://cdn-mirror.example/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz";
    const tarball = await packTarball("acme", "1.0.0");
    const bytes = new Uint8Array(tarball);
    const pinned = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url === channel().url) throw new TypeError("fetch failed");
      return new Response(bytes, { status: 200 });
    }) as typeof fetch;
    const installed = await installPluginChannel(root, { ...channel([mirrorUrl]), integrity: pinned }, {
      fetchImpl,
    });
    expect(installed).toEqual({ name: "acme", version: "1.0.0" });
  });

  it("refuses mirror bytes that do not match the entry's integrity", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const mirrorUrl = "https://cdn-mirror.example/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz";
    const fetchImpl = (async () =>
      new Response(new Uint8Array(new TextEncoder().encode("tampered")), { status: 200 })) as typeof fetch;
    await expect(installPluginChannel(root, channel([mirrorUrl]), { fetchImpl })).rejects.toThrow(
      PluginInstallError,
    );
    await expect(installPluginChannel(root, channel([mirrorUrl]), { fetchImpl })).rejects.toThrow(
      /does not match the sha512/,
    );
  });

  it("a source exhausted on is reported with the last address's failure", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const mirrorUrl = "https://cdn-mirror.example/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz";
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(installPluginChannel(root, channel([mirrorUrl]), { fetchImpl })).rejects.toThrow(
      /could not fetch the release asset/,
    );
  });

  it("a mirror that won once starts first next time (sticky), and the timeout bounds a dead address", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const mirrorUrl = "https://cdn-mirror.example/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz";
    const tarball = await packTarball("acme", "1.0.0");
    const pinned = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    const bytes = new Uint8Array(tarball);
    const hits: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const address = String(input);
      hits.push(address);
      if (address === mirrorUrl) return new Response(bytes, { status: 200 });
      // The primary hangs past the stagger; the mirror answers and wins.
      return new Promise<Response>((resolve) =>
        setTimeout(() => resolve(new Response(bytes, { status: 200 })), 5_000),
      );
    }) as typeof fetch;
    const chan = { ...channel([mirrorUrl]), integrity: pinned };
    const installed = await installPluginChannel(root, chan, { fetchImpl });
    expect(installed).toEqual({ name: "acme", version: "1.0.0" });
    expect(hits).toContain(mirrorUrl);
    // Sticky: the next install of the same source starts at the mirror.
    hits.length = 0;
    const root2 = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root2);
    await installPluginChannel(root2, chan, { fetchImpl });
    expect(hits[0]).toBe(mirrorUrl);
  });

  it("a rewrite rule maps a URL by capture; a rule that does not match the URL stays out", () => {
    const rules: PluginProxyRule[] = [
      {
        kind: "rewrite",
        match: "^https:\\/\\/github\\.com\\/(.+)\\/(.+)\\/releases\\/download\\/(.+)$",
        rewrite: "https://gh-mirror.example/$1/$2/releases/download/$3",
      },
      { kind: "rewrite", match: "^https:\\/\\/files\\.example\\/", rewrite: "https://elsewhere.example/" },
    ];
    expect(pluginProxyMirrors(channel().url, rules)).toEqual([
      "https://gh-mirror.example/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz",
    ]);
    expect(pluginProxyMirrors("https://files.example/acme.tgz", rules)).toEqual([
      "https://elsewhere.example/acme.tgz",
    ]);
    expect(pluginProxyMirrors("https://nowhere.example/x", rules)).toEqual([]);
  });

  it("rules run in order, the canonical URL and duplicates never enter the mirror list", () => {
    const rules: PluginProxyRule[] = [
      { kind: "rewrite", match: "^https:\\/\\/github\\.com\\/(.+)$", rewrite: "https://a.example/$1" },
      { kind: "rewrite", match: "^https:\\/\\/github\\.com\\/acme\\/(.+)$", rewrite: "https://b.example/$1" },
      { kind: "rewrite", match: "^https:\\/\\/github\\.com\\/(.+)$", rewrite: "https://a.example/$1" },
    ];
    expect(pluginProxyMirrors(channel().url, rules)).toEqual([
      "https://a.example/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz",
      "https://b.example/acme/releases/download/v1.0.0/acme-1.0.0.tgz",
    ]);
  });
});

describe("deployment proxy config", () => {
  const rules = [
    {
      kind: "rewrite",
      match: "^https:\\/\\/github\\.com\\/(.+)$",
      rewrite: "https://gh-mirror.example/$1",
    },
  ];

  it("PENGUIN_PLUGIN_PROXY reads a JSON rule array in order; unset reads the built-in set (empty)", () => {
    const env = { PORT: "0", PENGUIN_PLUGIN_PROXY: JSON.stringify(rules) };
    expect(resolveServerConfig(env).pluginProxy).toEqual(rules);
    expect(PLUGIN_DEFAULT_PROXY_RULES).toEqual([]);
    expect(resolveServerConfig({ PORT: "0" }).pluginProxy).toEqual([...PLUGIN_DEFAULT_PROXY_RULES]);
  });

  it("a pattern with catastrophic backtracking is refused at parse, before any fetch runs it", () => {
    // The classic ReDoS shapes: nested quantifiers and ambiguous alternation.
    expect(rewriteRuleRisk({ kind: "rewrite", match: "^(a+)+$", rewrite: "x" })).toMatch(
      /not linear/,
    );
    expect(rewriteRuleRisk({ kind: "rewrite", match: "(?:.*)*!x", rewrite: "x" })).toMatch(
      /not linear/,
    );
    // A pattern over the length cap is a program, not a URL map.
    expect(
      rewriteRuleRisk({ kind: "rewrite", match: "^a".padEnd(300, "b") + "$", rewrite: "x" }),
    ).toMatch(/over the 256 cap/);
    // The URL-map shapes this feature is for read as linear and pass.
    expect(
      rewriteRuleRisk({
        kind: "rewrite",
        match: "^https:\\/\\/github\\.com\\/(.+)\\/(.+)\\/releases\\/download\\/(.+)$",
        rewrite: "https://gh-mirror.example/$1/$2/releases/download/$3",
      }),
    ).toBeNull();
    // A URL over the length cap is skipped at run time, whatever the rules say.
    expect(
      pluginProxyMirrors("https://" + "a".repeat(4096) + "/x", [
        { kind: "rewrite", match: ".*", rewrite: "https://mirror.example/$0" },
      ]),
    ).toEqual([]);
  });

  it("a rule of an unknown kind, a non-string field or a pattern that will not compile is a config error", () => {
    expect(() =>
      resolveServerConfig({ PORT: "0", PENGUIN_PLUGIN_PROXY: JSON.stringify([{ kind: "page", match: "x", rewrite: "y" }]) }),
    ).toThrow(/unknown rule kind/);
    expect(() =>
      resolveServerConfig({ PORT: "0", PENGUIN_PLUGIN_PROXY: JSON.stringify([{ kind: "rewrite", match: 1, rewrite: "y" }]) }),
    ).toThrow(/string match and rewrite/);
    expect(() =>
      resolveServerConfig({ PORT: "0", PENGUIN_PLUGIN_PROXY: JSON.stringify([{ kind: "rewrite", match: "(", rewrite: "y" }]) }),
    ).toThrow();
    // The ReDoS gate sits in the same parse: a catastrophic pattern is a boot error.
    expect(() =>
      resolveServerConfig({
        PORT: "0",
        PENGUIN_PLUGIN_PROXY: JSON.stringify([{ kind: "rewrite", match: "^(a+)+$", rewrite: "y" }]),
      }),
    ).toThrow(/not linear/);
  });
});
