/**
 * Per-source CDN mirrors for the two fetches of the plugin install chain
 * (plugin/registry.ts httpPluginRegistry for the index document, plugin/install.ts
 * installPluginChannel for the channel's release asset):
 *
 * - The index read tries the source's own URL first, then the deployment's mirrors one at
 *   a time in the order given; a connection failure, a timeout and a non-ok answer each
 *   hand the read to the next address, and a source exhausted on is reported with the
 *   failure it ended on. The start of the order is where the last read succeeded (the
 *   sticky start): the next read begins at the address that carried the previous one, so
 *   a dead canonical's window is not paid read after read. No address is tried twice, and
 *   none is fetched after another has carried the read; a document that will not parse
 *   never makes its address the start.
 * - A channel install does the same over the asset: the URL the index published first,
 *   then the mirrors the rules rewrite it into; what arrives is verified against the
 *   entry's sha512 exactly as the canonical URL's would be — a mirror serving tampered
 *   bytes is refused like any other source.
 * - A rewrite rule maps a URL by capture; a rule that does not match the URL contributes
 *   nothing; a deployment with no mirrors behaves as before.
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
    await fs.writeFile(
      path.join(dir, "package", "package.json"),
      JSON.stringify({ name, version }),
    );
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
function fakeFetch(answers: Record<string, { status?: number; body?: string } | Error>): {
  fetch: typeof fetch;
  hits: string[];
  answers: Record<string, { status?: number; body?: string } | Error>;
} {
  const hits: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    hits.push(url);
    const answer = answers[url];
    if (answer === undefined) throw new TypeError("fetch failed");
    if (answer instanceof Error) throw answer;
    return new Response(answer.body ?? "", { status: answer.status ?? 200 });
  }) as typeof fetch;
  return { fetch: fetchImpl, hits, answers };
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
      httpPluginRegistry([url, mirror], {
        fetchImpl: registry.fetch,
        attempts: 1,
        delay: noWait,
      }).index(),
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

describe("the read walks the addresses in order", () => {
  const entry = [
    { name: "acme", version: "1.0.0", description: "d", authors: ["a"], license: "MIT" },
  ];

  it("the addresses are tried in the order given, once each, none re-fetched within one read", async () => {
    const url = "https://index.example/index.json";
    const mirror = "https://cdn-mirror.example/index.json";
    const registry = fakeFetch({ [url]: { status: 503 }, [mirror]: { body: "[]" } });
    const source = httpPluginRegistry([url, mirror], {
      fetchImpl: registry.fetch,
      attempts: 1,
      delay: noWait,
    });
    await source.index();
    expect(registry.hits).toEqual([url, mirror]);
    // One try per address per read, even when the read had to walk: the mirror's win
    // does not re-fetch the addresses that came before it within the same read.
    expect(new Set(registry.hits).size).toBe(registry.hits.length);
  });

  it("a source exhausted on reports the failure it ended on, with the addresses it named", async () => {
    const url = "https://index.example/index.json";
    const mirror = "https://cdn-mirror.example/index.json";
    const registry = fakeFetch({ [url]: { status: 404 }, [mirror]: new TypeError("fetch failed") });
    await expect(
      httpPluginRegistry([url, mirror], {
        fetchImpl: registry.fetch,
        attempts: 1,
        delay: noWait,
      }).index(),
    ).rejects.toThrow(/could not be fetched \(1 attempts\): fetch failed/);
    expect(registry.hits).toEqual([url, mirror]);
  });

  it("the sticky start: after a mirror served the read, the next read starts at it", async () => {
    const url = "https://index.example/index.json";
    const mirror = "https://cdn-mirror.example/index.json";
    const registry = fakeFetch({ [url]: { status: 503 }, [mirror]: { body: "[]" } });
    const source = httpPluginRegistry([url, mirror], {
      fetchImpl: registry.fetch,
      attempts: 1,
      delay: noWait,
    });
    await source.index();
    expect(registry.hits).toEqual([url, mirror]);
    // Memory, not a speed test: the walk still tries one address at a time, only its
    // start moves — the mirror that carried the last read leads the next one.
    registry.hits.length = 0;
    await source.index();
    expect(registry.hits).toEqual([mirror]);
  });

  it("a dead sticky start hands the walk back to the configured order within the same read", async () => {
    const url = "https://index.example/index.json";
    const mirror = "https://cdn-mirror.example/index.json";
    const registry = fakeFetch({ [url]: { status: 503 }, [mirror]: { body: "[]" } });
    const source = httpPluginRegistry([url, mirror], {
      fetchImpl: registry.fetch,
      attempts: 1,
      delay: noWait,
    });
    await source.index();
    expect(registry.hits).toEqual([url, mirror]);
    // The mirror goes dead after its win: the next read still starts at it, pays one
    // window, and the configured order carries the read from there.
    registry.answers[url] = { body: "[]" };
    registry.answers[mirror] = new TypeError("fetch failed");
    registry.hits.length = 0;
    const entries = await source.index();
    expect(entries).toEqual([]);
    expect(registry.hits).toEqual([mirror, url]);
    // And the start follows the address that now serves the document.
    registry.hits.length = 0;
    await source.index();
    expect(registry.hits).toEqual([url]);
  });

  it("a bad document never becomes the sticky start: the next read starts over", async () => {
    const url = "https://index.example/index.json";
    const mirror = "https://cdn-mirror.example/index.json";
    const registry = fakeFetch({
      [url]: { status: 503 },
      [mirror]: { body: "not json" },
    });
    const source = httpPluginRegistry([url, mirror], {
      fetchImpl: registry.fetch,
      attempts: 1,
      delay: noWait,
    });
    await expect(source.index()).rejects.toThrow(/not valid JSON/);
    expect(registry.hits).toEqual([url, mirror]);
    // The mirror answered but its document was refused: nothing is remembered, the next
    // read starts over at the configured order.
    registry.answers[mirror] = { body: "[]" };
    registry.hits.length = 0;
    await source.index();
    expect(registry.hits).toEqual([url, mirror]);
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

describe("channel mirrors", () => {
  const asset = new TextEncoder().encode("a release tarball's bytes");
  const integrity = `sha512-${createHash("sha512").update(asset).digest("base64")}`;

  // Each order-sensitive test names its own channel URL: the sticky start is remembered
  // per channel URL for the whole process, so tests that assert the walk's first step
  // must not share a key with a test that moves it.
  const channel = (
    mirrors?: string[],
    url = "https://github.com/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz",
  ): IndexChannel => ({
    name: "acme",
    version: "1.0.0",
    integrity,
    url,
    mirrors,
  });

  it("installs from the mirror after the release URL failed, same verified bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const mirrorUrl =
      "https://cdn-mirror.example/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz";
    const tarball = await packTarball("acme", "1.0.0");
    const bytes = new Uint8Array(tarball);
    const pinned = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url === channel().url) throw new TypeError("fetch failed");
      return new Response(bytes, { status: 200 });
    }) as typeof fetch;
    const installed = await installPluginChannel(
      root,
      { ...channel([mirrorUrl]), integrity: pinned },
      {
        fetchImpl,
      },
    );
    expect(installed).toEqual({ name: "acme", version: "1.0.0" });
  });

  it("refuses mirror bytes that do not match the entry's integrity", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const mirrorUrl =
      "https://cdn-mirror.example/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz";
    const fetchImpl = (async () =>
      new Response(new Uint8Array(new TextEncoder().encode("tampered")), {
        status: 200,
      })) as typeof fetch;
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
    const mirrorUrl =
      "https://cdn-mirror.example/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz";
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(installPluginChannel(root, channel([mirrorUrl]), { fetchImpl })).rejects.toThrow(
      /could not fetch the release asset/,
    );
  });

  it("the release URL is tried first, the mirrors after it, once each", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const canonicalUrl = "https://github.com/acme/acme/releases/download/v1.0.3/acme-1.0.3.tgz";
    const mirrorUrl =
      "https://cdn-mirror.example/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz";
    const tarball = await packTarball("acme", "1.0.0");
    const pinned = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    const bytes = new Uint8Array(tarball);
    const hits: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const address = String(input);
      hits.push(address);
      if (address === mirrorUrl) return new Response(bytes, { status: 200 });
      // The release URL answers, then stalls mid-body: its headers said ok, its bytes
      // never arrive — the download moves to the mirror all the same. A synthetic body
      // is not wired to the abort signal, so the fake rejects on it instead, which is
      // what the wire does to a stalled read when the window runs out.
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(bytes.byteLength) }),
        body: null,
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((_, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("This operation was aborted", "TimeoutError")),
            ),
          ),
      } as unknown as Response;
    }) as typeof fetch;
    const chan = { ...channel([mirrorUrl], canonicalUrl), integrity: pinned };
    const installed = await installPluginChannel(root, chan, { fetchImpl, timeoutMs: 50 });
    expect(installed).toEqual({ name: "acme", version: "1.0.0" });
    expect(hits).toEqual([canonicalUrl, mirrorUrl]);
  });

  it("the sticky start: after a mirror carried the install, the next install starts at it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const canonicalUrl = "https://github.com/acme/acme/releases/download/v1.0.4/acme-1.0.4.tgz";
    const mirrorUrl =
      "https://cdn-mirror.example/acme/acme/releases/download/v1.0.4/acme-1.0.4.tgz";
    const tarball = await packTarball("acme", "1.0.0");
    const pinned = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    const bytes = new Uint8Array(tarball);
    const hits: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const address = String(input);
      hits.push(address);
      if (address === mirrorUrl) return new Response(bytes, { status: 200 });
      // The release URL answers, then stalls mid-body: its headers said ok, its bytes
      // never arrive — the download moves to the mirror all the same. A synthetic body
      // is not wired to the abort signal, so the fake rejects on it instead, which is
      // what the wire does to a stalled read when the window runs out.
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(bytes.byteLength) }),
        body: null,
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((_, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("This operation was aborted", "TimeoutError")),
            ),
          ),
      } as unknown as Response;
    }) as typeof fetch;
    const chan = { ...channel([mirrorUrl], canonicalUrl), integrity: pinned };
    const installed = await installPluginChannel(root, chan, { fetchImpl, timeoutMs: 50 });
    expect(installed).toEqual({ name: "acme", version: "1.0.0" });
    expect(hits).toEqual([canonicalUrl, mirrorUrl]);
    // Memory, not a speed test: the walk still tries one address at a time, only its
    // start moves — the mirror that carried the last install (its bytes verified) leads
    // the next one, and the dead canonical's window is not paid again.
    hits.length = 0;
    const root2 = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root2);
    await installPluginChannel(root2, chan, { fetchImpl, timeoutMs: 50 });
    expect(hits).toEqual([mirrorUrl]);
  });

  it("bytes that fail the integrity check never become the sticky start", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const canonicalUrl = "https://github.com/acme/acme/releases/download/v1.0.5/acme-1.0.5.tgz";
    const mirrorUrl =
      "https://cdn-mirror.example/acme/acme/releases/download/v1.0.5/acme-1.0.5.tgz";
    const tarball = await packTarball("acme", "1.0.0");
    const pinned = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    const good = new Uint8Array(tarball);
    const bad = new Uint8Array(new TextEncoder().encode("tampered"));
    const hits: string[] = [];
    let served = 0;
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const address = String(input);
      hits.push(address);
      if (address !== mirrorUrl) throw new TypeError("fetch failed");
      // The mirror serves tampered bytes on the first install, good ones on the second.
      served += 1;
      return new Response(served === 1 ? bad : good, { status: 200 });
    }) as typeof fetch;
    const chan = { ...channel([mirrorUrl], canonicalUrl), integrity: pinned };
    await expect(
      installPluginChannel(root, chan, { fetchImpl, timeoutMs: 50 }),
    ).rejects.toThrow(/does not match the sha512/);
    expect(hits).toEqual([canonicalUrl, mirrorUrl]);
    // The refusal is not remembered: the next install still starts at the canonical URL
    // — the mirror's earlier try, bad bytes and all, bought it no start.
    hits.length = 0;
    const root2 = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root2);
    await installPluginChannel(root2, chan, { fetchImpl, timeoutMs: 50 });
    expect(hits).toEqual([canonicalUrl, mirrorUrl]);
  });

  it("every address dead: the error names the addresses and the failure it ended on", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const canonicalUrl = "https://github.com/acme/acme/releases/download/v1.0.6/acme-1.0.6.tgz";
    const mirrorUrl =
      "https://cdn-mirror.example/acme/acme/releases/download/v1.0.6/acme-1.0.6.tgz";
    const registry = fakeFetch({});
    await expect(
      installPluginChannel(
        root,
        {
          ...channel([mirrorUrl], canonicalUrl),
          integrity: "sha512-xxx",
        },
        {
          fetchImpl: registry.fetch,
          timeoutMs: 50,
        },
      ),
    ).rejects.toThrow(
      /could not fetch the release asset from any of https:\/\/github\.com\/acme\/acme\/releases\/download\/v1\.0\.6\/acme-1\.0\.6\.tgz, https:\/\/cdn-mirror\.example\/acme\/acme\/releases\/download\/v1\.0\.6\/acme-1\.0\.6\.tgz: fetch failed/,
    );
  });

  it("a rewrite rule maps a URL by capture; a rule that does not match the URL stays out", () => {
    const rules: PluginProxyRule[] = [
      {
        kind: "rewrite",
        match: "^https:\\/\\/github\\.com\\/(.+)\\/(.+)\\/releases\\/download\\/(.+)$",
        rewrite: "https://gh-mirror.example/$1/$2/releases/download/$3",
      },
      {
        kind: "rewrite",
        match: "^https:\\/\\/files\\.example\\/",
        rewrite: "https://elsewhere.example/",
      },
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
      {
        kind: "rewrite",
        match: "^https:\\/\\/github\\.com\\/(.+)$",
        rewrite: "https://a.example/$1",
      },
      {
        kind: "rewrite",
        match: "^https:\\/\\/github\\.com\\/acme\\/(.+)$",
        rewrite: "https://b.example/$1",
      },
      {
        kind: "rewrite",
        match: "^https:\\/\\/github\\.com\\/(.+)$",
        rewrite: "https://a.example/$1",
      },
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

  // The boundary samples below run safe-regex over a 65,536-character pattern; that
  // parse takes longer than the default 5 s test timeout, so this case carries its own.
  it(
    "a pattern with catastrophic backtracking is refused at parse, before any fetch runs it",
    { timeout: 30_000 },
    () => {
    // The classic ReDoS shapes: nested quantifiers and ambiguous alternation.
    expect(rewriteRuleRisk({ kind: "rewrite", match: "^(a+)+$", rewrite: "x" })).toMatch(
      /not linear/,
    );
    expect(rewriteRuleRisk({ kind: "rewrite", match: "(?:.*)*!x", rewrite: "x" })).toMatch(
      /not linear/,
    );
    // A pattern can only ever match one URL, so its bound is the URL length the web
    // itself allows (Firefox's 65,536); anything longer is a program, not a URL map.
    expect(
      rewriteRuleRisk({ kind: "rewrite", match: "b".repeat(65537), rewrite: "x" }),
    ).toMatch(/over the 65536 cap/);
    // A pattern of the largest legal URL length passes.
    expect(rewriteRuleRisk({ kind: "rewrite", match: "b".repeat(65536), rewrite: "x" })).toBeNull();
    // The URL-map shapes this feature is for read as linear and pass.
    expect(
      rewriteRuleRisk({
        kind: "rewrite",
        match: "^https:\\/\\/github\\.com\\/(.+)\\/(.+)\\/releases\\/download\\/(.+)$",
        rewrite: "https://gh-mirror.example/$1/$2/releases/download/$3",
      }),
    ).toBeNull();
    // A very long URL is still a URL: the rules run over it as usual. The ReDoS gate is
    // the pattern's shape (safe-regex at parse), not the input's length — a linear
    // pattern over a long string stays linear.
    expect(
      pluginProxyMirrors("https://" + "a".repeat(4096) + "/x", [
        { kind: "rewrite", match: ".*", rewrite: "https://mirror.example/$&" },
      ]),
    ).toEqual(["https://mirror.example/https://" + "a".repeat(4096) + "/x"]);
  });

  it("a rule of an unknown kind, a non-string field or a pattern that will not compile is a config error", () => {
    expect(() =>
      resolveServerConfig({
        PORT: "0",
        PENGUIN_PLUGIN_PROXY: JSON.stringify([{ kind: "page", match: "x", rewrite: "y" }]),
      }),
    ).toThrow(/unknown rule kind/);
    expect(() =>
      resolveServerConfig({
        PORT: "0",
        PENGUIN_PLUGIN_PROXY: JSON.stringify([{ kind: "rewrite", match: 1, rewrite: "y" }]),
      }),
    ).toThrow(/string match and rewrite/);
    expect(() =>
      resolveServerConfig({
        PORT: "0",
        PENGUIN_PLUGIN_PROXY: JSON.stringify([{ kind: "rewrite", match: "(", rewrite: "y" }]),
      }),
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
