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
 * - A channel install hands each address to npm itself (the URL is a spec npm natively
 *   understands) and verifies what npm actually installed after the fact: the lockfile
 *   entry's integrity against the entry's sha512, and the installed manifest against the
 *   entry's name and version. An npm failure and a refused install each hand the walk to
 *   the next address; a refused install is uninstalled, and a bad address never becomes
 *   the sticky start.
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
import { installPluginChannel } from "../src/plugin/install.js";
import {
  httpPluginRegistry,
  pluginProxyMirrors,
  rewriteRuleRisk,
  type IndexChannel,
  type PluginProxyRule,
} from "../src/plugin/registry.js";
import {
  MIRROR_RULES,
  MIRROR_IDS,
  indexMirrorRules,
  mirrorRulesOf,
  setIndexMirrors,
} from "../src/plugin/mirror-settings.js";

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
  // Each order-sensitive test names its own channel URL: the sticky start is remembered
  // per channel URL for the whole process, so tests that assert the walk's first step
  // must not share a key with a test that moves it.
  const channel = (
    mirrors?: string[],
    url = "https://github.com/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz",
  ): IndexChannel => ({
    name: "acme",
    version: "1.0.0",
    integrity: "sha512-pinned",
    url,
    mirrors,
  });

  const digestOf = (tarball: Uint8Array) =>
    `sha512-${createHash("sha512").update(tarball).digest("base64")}`;

  /**
   * A stand-in for npm: the install records the spec it was given, writes the package
   * into the prefix, and writes the lockfile entry npm itself records for a tarball-URL
   * install — `resolved` naming the URL, `integrity` naming the tarball it actually took.
   * An Error stands for npm's own failure on that spec (a dead address, an unreadable
   * asset): npm exits non-zero and nothing lands.
   */
  const npmStandIn = (
    answers: Record<string, { integrity: string; name?: string; version?: string } | Error>,
  ) => {
    const specs: string[] = [];
    const uninstalls: string[] = [];
    const install = async (prefix: string, spec: string) => {
      specs.push(spec);
      const answer = answers[spec];
      if (answer === undefined)
        throw new Error(`npm error code EFETCH\nnpm error cannot fetch ${spec}`);
      if (answer instanceof Error) throw answer;
      const name = answer.name ?? "acme";
      const version = answer.version ?? "1.0.0";
      const key = `node_modules/${name}`;
      await fs.mkdir(path.join(prefix, ...key.split("/")), { recursive: true });
      await fs.writeFile(
        path.join(prefix, ...key.split("/"), "package.json"),
        JSON.stringify({ name, version }),
      );
      const manifestPath = path.join(prefix, "package.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8").catch(() => "{}")) as {
        dependencies?: Record<string, string>;
      };
      manifest.dependencies = { ...(manifest.dependencies ?? {}), [name]: url_of(spec) };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      const lockPath = path.join(prefix, "package-lock.json");
      const lock = JSON.parse(await fs.readFile(lockPath, "utf8").catch(() => "{}")) as {
        packages?: Record<string, { resolved?: string; integrity?: string }>;
      };
      lock.packages = {
        ...(lock.packages ?? {}),
        [key]: { resolved: url_of(spec), integrity: answer.integrity },
      };
      await fs.writeFile(lockPath, JSON.stringify(lock, null, 2));
    };
    const url_of = (spec: string) => spec;
    const uninstall = async (_prefix: string, name: string) => {
      uninstalls.push(name);
    };
    return { install, uninstall, specs, uninstalls };
  };

  it("installs through npm from the mirror after the release URL failed, the lockfile record verifying", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const mirrorUrl =
      "https://cdn-mirror.example/acme/acme/releases/download/v1.0.0/acme-1.0.0.tgz";
    const tarball = await packTarball("acme", "1.0.0");
    const npm = npmStandIn({
      [channel().url]: new Error("npm error code EFETCH\nnpm error fetch failed"),
      [mirrorUrl]: { integrity: digestOf(tarball) },
    });
    const installed = await installPluginChannel(
      root,
      { ...channel([mirrorUrl]), integrity: digestOf(tarball) },
      { install: npm.install, uninstall: npm.uninstall },
    );
    expect(installed).toEqual({ name: "acme", version: "1.0.0" });
    // The release URL went to npm first and failed there; the mirror's spec installed.
    expect(npm.specs).toEqual([channel().url, mirrorUrl]);
    expect(npm.uninstalls).toEqual([]);
    // What npm wrote stays: the lockfile entry and the installed manifest are the record.
    const lock = JSON.parse(
      await fs.readFile(path.join(root, "plugins", "package-lock.json"), "utf8"),
    ) as { packages: Record<string, { resolved?: string }> };
    expect(lock.packages["node_modules/acme"]?.resolved).toBe(mirrorUrl);
  });

  it("refuses an install whose tarball does not match the entry's integrity, uninstalls it, and takes the next address", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const canonicalUrl = "https://github.com/acme/acme/releases/download/v1.0.2/acme-1.0.2.tgz";
    const badMirror = "https://cdn-mirror.example/bad/acme-1.0.2.tgz";
    const goodMirror = "https://cdn-mirror.example/good/acme-1.0.2.tgz";
    const tarball = await packTarball("acme", "1.0.0");
    const npm = npmStandIn({
      [canonicalUrl]: new Error("npm error code EFETCH\nnpm error fetch failed"),
      [badMirror]: { integrity: "sha512-tamperedbytesaresolong" },
      [goodMirror]: { integrity: digestOf(tarball) },
    });
    const installed = await installPluginChannel(
      root,
      { ...channel([badMirror, goodMirror], canonicalUrl), integrity: digestOf(tarball) },
      { install: npm.install, uninstall: npm.uninstall },
    );
    expect(installed).toEqual({ name: "acme", version: "1.0.0" });
    expect(npm.specs).toEqual([canonicalUrl, badMirror, goodMirror]);
    // The refused install did not stay in the prefix: npm uninstalled what the bad
    // address's install had put there, so nothing tampered remains on disk.
    expect(npm.uninstalls).toEqual(["acme"]);
  });

  it("refuses an install whose manifest is not the entry's package and version", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const tarball = await packTarball("acme", "1.0.0");
    const npm = npmStandIn({
      [channel().url]: { integrity: digestOf(tarball), name: "other-package", version: "9.9.9" },
    });
    await expect(
      installPluginChannel(
        root,
        { ...channel(), integrity: digestOf(tarball) },
        { install: npm.install, uninstall: npm.uninstall },
      ),
    ).rejects.toThrow(/package\.json says "other-package"@"9\.9\.9"/);
    // The wrong package is uninstalled; nothing of it stays for the caller's vetting.
    expect(npm.uninstalls).toEqual(["acme"]);
  });

  it("a source exhausted is reported with the addresses tried and the failure it ended on", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const canonicalUrl = "https://github.com/acme/acme/releases/download/v1.0.6/acme-1.0.6.tgz";
    const mirrorUrl =
      "https://cdn-mirror.example/acme/acme/releases/download/v1.0.6/acme-1.0.6.tgz";
    const npm = npmStandIn({
      [canonicalUrl]: new Error("npm error code EFETCH\nnpm error fetch failed"),
      [mirrorUrl]: new Error("npm error code EFETCH\nnpm error fetch failed"),
    });
    await expect(
      installPluginChannel(root, channel([mirrorUrl], canonicalUrl), {
        install: npm.install,
        uninstall: npm.uninstall,
      }),
    ).rejects.toThrow(
      /could not install the release asset from any of .*acme-1\.0\.6\.tgz, .*acme-1\.0\.6\.tgz: npm error/,
    );
  });

  it("the sticky start: after a mirror carried the install, the next install starts at it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const canonicalUrl = "https://github.com/acme/acme/releases/download/v1.0.4/acme-1.0.4.tgz";
    const mirrorUrl =
      "https://cdn-mirror.example/acme/acme/releases/download/v1.0.4/acme-1.0.4.tgz";
    const tarball = await packTarball("acme", "1.0.0");
    const npm = npmStandIn({
      [canonicalUrl]: new Error("npm error code EFETCH\nnpm error fetch failed"),
      [mirrorUrl]: { integrity: digestOf(tarball) },
    });
    const chan = { ...channel([mirrorUrl], canonicalUrl), integrity: digestOf(tarball) };
    await installPluginChannel(root, chan, { install: npm.install, uninstall: npm.uninstall });
    expect(npm.specs).toEqual([canonicalUrl, mirrorUrl]);
    // Memory, not a speed test: the walk still tries one address at a time, only its
    // start moves — the mirror that carried the last install (its record verified) leads
    // the next one, and the dead canonical's window is not paid again.
    const root2 = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root2);
    await installPluginChannel(root2, chan, { install: npm.install, uninstall: npm.uninstall });
    expect(npm.specs).toEqual([canonicalUrl, mirrorUrl, mirrorUrl]);
  });

  it("an install that fails the checks never becomes the sticky start", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root);
    const canonicalUrl = "https://github.com/acme/acme/releases/download/v1.0.5/acme-1.0.5.tgz";
    const badMirror = "https://cdn-mirror.example/bad/acme-1.0.5.tgz";
    const goodMirror = "https://cdn-mirror.example/good/acme-1.0.5.tgz";
    const tarball = await packTarball("acme", "1.0.0");
    const npm = npmStandIn({
      [canonicalUrl]: new Error("npm error code EFETCH\nnpm error fetch failed"),
      [badMirror]: { integrity: "sha512-tamperedbytesaresolong" },
      [goodMirror]: { integrity: digestOf(tarball) },
    });
    const chan = {
      ...channel([badMirror, goodMirror], canonicalUrl),
      integrity: digestOf(tarball),
    };
    await installPluginChannel(root, chan, { install: npm.install, uninstall: npm.uninstall });
    expect(npm.specs).toEqual([canonicalUrl, badMirror, goodMirror]);
    // The refusal is not remembered — but the mirror whose install verified is: the next
    // install starts at the good mirror, not back at the canonical URL.
    const root2 = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cdn-"));
    roots.push(root2);
    await installPluginChannel(root2, chan, { install: npm.install, uninstall: npm.uninstall });
    expect(npm.specs).toEqual([canonicalUrl, badMirror, goodMirror, goodMirror]);
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

describe("plugin mirrors, as a settings group", () => {
  it("the user's choice runs the chosen mirrors' rules in try order; the default runs none", () => {
    expect(indexMirrorRules()).toEqual([]);
    setIndexMirrors(mirrorRulesOf(["npm-registry", "github-proxy"]));
    try {
      // The npm registry mirror first, the GitHub content proxy second: the choice's order.
      expect(indexMirrorRules()).toEqual([
        {
          kind: "rewrite",
          match: "^https:\\/\\/registry\\.npmjs\\.org\\/(.+)$",
          rewrite: "https://registry.npmmirror.com/$1",
        },
        {
          kind: "rewrite",
          match: "^https:\\/\\/github\\.com\\/(.+)$",
          rewrite: "https://gh-proxy.com/https://github.com/$1",
        },
      ]);
    } finally {
      setIndexMirrors([]);
    }
  });

  // The boundary samples below run safe-regex over a 65,536-character pattern; that
  // parse takes tens of seconds (the checker walks the pattern's tree, and a literal
  // that long is tens of thousands of nodes), so this case carries its own timeout.
  it(
    "a pattern with catastrophic backtracking is refused at parse, before any fetch runs it",
    { timeout: 120_000 },
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
      expect(rewriteRuleRisk({ kind: "rewrite", match: "b".repeat(65537), rewrite: "x" })).toMatch(
        /over the 65536 cap/,
      );
      // A pattern of the largest legal URL length passes.
      expect(
        rewriteRuleRisk({ kind: "rewrite", match: "b".repeat(65536), rewrite: "x" }),
      ).toBeNull();
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
    },
  );
  it("an unknown mirror id, a non-array or a stale document contributes nothing", () => {
    expect(mirrorRulesOf(["no-such-mirror"])).toEqual([]);
    expect(mirrorRulesOf("npm-registry")).toEqual([]);
    expect(mirrorRulesOf(undefined)).toEqual([]);
    expect(mirrorRulesOf([1, "github-proxy"])).toEqual(
      MIRROR_RULES[MIRROR_IDS.indexOf("github-proxy")],
    );
    setIndexMirrors(mirrorRulesOf(["github-raw"]));
    try {
      // jsDelivr serves a repository's files at its tag: raw URLs map onto the /gh/ shape.
      expect(indexMirrorRules()).toEqual([
        {
          kind: "rewrite",
          match: "^https:\\/\\/raw\\.githubusercontent\\.com\\/([^/]+)\\/([^/]+)\\/(.*)$",
          rewrite: "https://fastly.jsdelivr.net/gh/$1/$2@$3",
        },
      ]);
    } finally {
      setIndexMirrors([]);
    }
  });
>>>>>>> 14ba6f87e4 (feat(plugins): the channel install hands the release URL to npm itself and verifies what it installed after the fact)

  // The built-in rules run over real URLs the way the fetches will: each rewrite lands on
  // the mirror's own shape, and a URL none of them match contributes nothing.
  it("the built-in rules rewrite the URLs they are for", () => {
    for (const rules of MIRROR_RULES) {
      for (const rule of rules) expect(rewriteRuleRisk(rule)).toBeNull();
    }
    expect(
      pluginProxyMirrors("https://registry.npmjs.org/acme/-/acme-1.0.0.tgz", MIRROR_RULES[0]),
    ).toEqual(["https://registry.npmmirror.com/acme/-/acme-1.0.0.tgz"]);
    expect(
      pluginProxyMirrors(
        "https://raw.githubusercontent.com/acme/acme/main/README.md",
        MIRROR_RULES[1],
      ),
    ).toEqual(["https://fastly.jsdelivr.net/gh/acme/acme@main/README.md"]);
    expect(
      pluginProxyMirrors("https://github.com/acme/acme/releases/download/v1.0.0/acme.tgz", MIRROR_RULES[2]),
    ).toEqual(["https://gh-proxy.com/https://github.com/acme/acme/releases/download/v1.0.0/acme.tgz"]);
    expect(pluginProxyMirrors("https://example.com/x", MIRROR_RULES[0])).toEqual([]);
  });
});
