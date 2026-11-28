/**
 * Installing a plugin through the published index's github release channel
 * (plugin/install.ts installPluginChannel, plugin/registry.ts indexChannelLookup +
 * indexChannelOf, and the install route's npm-first fallthrough):
 *
 * - The channel's release asset is downloaded by the server itself (the default path): the
 *   bytes are counted as they land, a download that keeps moving has no time limit while a
 *   stalled one is cut, and the file is verified against the entry's sha512 before npm
 *   unpacks the local tarball — what npm actually installed is checked afterwards against
 *   the entry's name and version. A caller may still stand npm's own install in (the
 *   injected `install`, the shape the tests below exercise): the address is then handed
 *   over as npm's spec, and the lockfile's integrity record verifies it.
 * - A mismatch, an unreadable integrity, or a channel listed without an integrity refuses the
 *   install with the reason; a refused install is uninstalled — nothing unverified stays.
 * - npm stays the first source: a name npm installs never consults the index, and a channel
 *   install is only the fallthrough for a name npm answered E404/ETARGET on (the version
 *   asked for goes with the lookup); any other npm failure stays a failure.
 * - The installed package's manifest has to be the index entry's package and version before
 *   the install counts; a different package refuses and npm uninstalls it.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installPluginChannel,
  npmFailureKind,
  npmRegistryNamed,
  PluginInstallError,
  pluginsPrefix,
  type NpmRun,
} from "../src/plugin/install.js";
import {
  indexChannelLookup,
  indexChannelOf,
  type IndexChannel,
  type IndexDocumentEntry,
} from "../src/plugin/registry.js";
import { installNamedOrChanneled } from "../src/http/routes/plugins-installed.js";

const execFileAsync = promisify(execFile);

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

const tempRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-channel-"));
  roots.push(root);
  return root;
};

/**
 * A real gzipped tarball carrying `package/package.json` with the given name and version —
 * the bytes a release asset carries, whose digest the stand-in npm records as the
 * integrity of what it installed.
 */
async function packTarball(name: string, version: string): Promise<Uint8Array> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-pkg-"));
  try {
    await fs.mkdir(path.join(dir, "package"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "package", "package.json"),
      JSON.stringify({ name, version }),
    );
    // Relative to the dir: a Windows path carries a drive letter, which GNU tar reads as a
    // remote host name.
    await execFileAsync("tar", ["-czf", "asset.tgz", "package"], { cwd: dir });
    return new Uint8Array(await fs.readFile(path.join(dir, "asset.tgz")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const digest = (bytes: Uint8Array) =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const asset = new TextEncoder().encode("a release tarball's bytes");
const integrity = digest(asset);

const channel: IndexChannel = {
  name: "@penguinharness/language-typst",
  version: "0.0.2",
  integrity,
  url: "https://github.com/o/r/releases/download/v0.0.2/x.tgz",
};

describe("npmFailureKind", () => {
  it("calls a missing package or an unmatched version unavailable", () => {
    expect(
      npmFailureKind(
        "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/x",
      ),
    ).toBe("unavailable");
    expect(
      npmFailureKind("npm error code ETARGET\nnpm error Not Found - no match for ^3.0.0"),
    ).toBe("unavailable");
  });

  it("calls a registry that did not answer unreachable, and names it", () => {
    for (const stderr of [
      "npm error code ETIMEDOUT\nnpm error network request to https://registry.npmjs.org/x failed, reason: connect ETIMEDOUT",
      "npm error code ENOTFOUND\nnpm error network request to https://registry.npmmirror.com/x failed, reason: getaddrinfo ENOTFOUND",
      "npm error code ERR_SOCKET_TIMEOUT\nnpm error network Socket timeout",
      "npm error code ECONNRESET\nnpm error network aborted",
      // An http(s) proxy that could not reach the registry either.
      "npm error code E502\nnpm error 502 Bad Gateway - GET http://10.255.255.1:4873/x",
    ]) {
      expect(npmFailureKind(stderr), stderr).toBe("unreachable");
    }
    expect(
      npmRegistryNamed(
        "npm error 404 Not Found - GET https://registry.npmmirror.com/@acme%2fx - Not found",
      ),
    ).toBe("https://registry.npmmirror.com");
    expect(npmRegistryNamed("npm error code EACCES")).toBeUndefined();
  });

  it("calls every other npm failure other", () => {
    expect(npmFailureKind("npm error code EACCES\nnpm error permission denied")).toBe("other");
    expect(
      npmFailureKind(
        "npm error code ELIFECYCLE\nnpm error Exit status 1\nnpm error A complete log",
      ),
    ).toBe("other");
    expect(npmFailureKind(undefined)).toBe("other");
  });
});

describe("installPluginChannel", () => {
  /**
   * A stand-in for npm: the install records the spec it was given, writes the package into
   * the prefix, and writes the lockfile entry npm itself records for a tarball-URL install
   * — `resolved` naming the URL, `integrity` naming the tarball it actually took. An Error
   * stands for npm's own failure on that spec (a dead address, an unreadable asset): npm
   * exits non-zero and nothing lands.
   */
  const npmStandIn = (
    answers: Record<string, { integrity: string; name?: string; version?: string } | Error>,
  ) => {
    const specs: string[] = [];
    const uninstalls: string[] = [];
    const install = async (prefix: string, spec: string) => {
      specs.push(spec);
      const answer = answers[spec];
      if (answer === undefined || answer instanceof Error) {
        throw new Error(`npm error code EFETCH\nnpm error cannot fetch ${spec}`);
      }
      const name = answer.name ?? channel.name;
      const version = answer.version ?? channel.version;
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
      manifest.dependencies = { ...(manifest.dependencies ?? {}), [name]: spec };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      const lockPath = path.join(prefix, "package-lock.json");
      const lock = JSON.parse(await fs.readFile(lockPath, "utf8").catch(() => "{}")) as {
        packages?: Record<string, { resolved?: string; integrity?: string }>;
      };
      lock.packages = {
        ...(lock.packages ?? {}),
        [key]: { resolved: spec, integrity: answer.integrity },
      };
      await fs.writeFile(lockPath, JSON.stringify(lock, null, 2));
    };
    const uninstall = async (_prefix: string, name: string) => {
      uninstalls.push(name);
    };
    return { install, uninstall, specs, uninstalls };
  };

  it("installs through npm from the release URL, the lockfile record verifying against the entry's sha512", async () => {
    const root = await tempRoot();
    const tarball = await packTarball(channel.name, channel.version);
    const npm = npmStandIn({ [channel.url]: { integrity: digest(tarball) } });
    const installed = await installPluginChannel(
      root,
      { ...channel, integrity: digest(tarball) },
      { install: npm.install, uninstall: npm.uninstall },
    );
    expect(installed).toEqual({ name: channel.name, version: channel.version });
    // The spec npm received was the release URL itself, not a re-packed archive: npm does
    // the download, and the record it wrote is what verified.
    expect(npm.specs).toEqual([channel.url]);
    expect(npm.uninstalls).toEqual([]);
    const lock = JSON.parse(
      await fs.readFile(path.join(pluginsPrefix(root), "package-lock.json"), "utf8"),
    ) as { packages?: Record<string, { resolved?: string; integrity?: string }> };
    expect(lock.packages?.[`node_modules/${channel.name}`]).toEqual({
      resolved: channel.url,
      integrity: digest(tarball),
    });
  });

  it("refuses an install whose tarball does not match the entry's integrity — npm uninstalls it", async () => {
    const root = await tempRoot();
    const npm = npmStandIn({
      [channel.url]: { integrity: digest(new TextEncoder().encode("tampered bytes")) },
    });
    await expect(
      installPluginChannel(root, channel, { install: npm.install, uninstall: npm.uninstall }),
    ).rejects.toThrow(/does not match the sha512/);
    expect(npm.uninstalls).toEqual([channel.name]);
  });

  it("refuses an install whose manifest is not the entry's package and version — npm uninstalls it", async () => {
    const root = await tempRoot();
    const tarball = await packTarball(channel.name, channel.version);
    const npm = npmStandIn({
      [channel.url]: { integrity: digest(tarball), name: "other-package", version: "9.9.9" },
    });
    await expect(
      installPluginChannel(
        root,
        { ...channel, integrity: digest(tarball) },
        { install: npm.install, uninstall: npm.uninstall },
      ),
    ).rejects.toThrow(/package\.json says "other-package"@"9\.9\.9"/);
    expect(npm.uninstalls).toEqual([channel.name]);
  });

  it("refuses an install npm recorded no integrity for", async () => {
    const root = await tempRoot();
    const npm = npmStandIn({ [channel.url]: { integrity: "not-a-digest" } });
    await expect(
      installPluginChannel(root, channel, { install: npm.install, uninstall: npm.uninstall }),
    ).rejects.toThrow(/does not match the sha512/);
    expect(npm.uninstalls).toEqual([channel.name]);
  });

  it("an npm failure on the release URL is the whole answer when the entry pins no mirrors", async () => {
    const root = await tempRoot();
    const npm = npmStandIn({});
    await expect(
      installPluginChannel(root, channel, { install: npm.install, uninstall: npm.uninstall }),
    ).rejects.toThrow(/could not install the release asset from any of/);
    expect(npm.specs).toEqual([channel.url]);
    expect(npm.uninstalls).toEqual([]);
  });

  it("a pin that is not sha512-<base64> cannot pass the post-check, and npm uninstalls", async () => {
    const root = await tempRoot();
    const tarball = await packTarball(channel.name, channel.version);
    const npm = npmStandIn({ [channel.url]: { integrity: digest(tarball) } });
    await expect(
      installPluginChannel(
        root,
        { ...channel, integrity: "md5-abc" },
        { install: npm.install, uninstall: npm.uninstall },
      ),
    ).rejects.toThrow(/does not match the sha512/);
    expect(npm.uninstalls).toEqual([channel.name]);
  });

  it("the mirror after a dead release URL: npm fails there, installs from the mirror", async () => {
    const root = await tempRoot();
    const mirrorUrl = "https://cdn-mirror.example/o/r/releases/download/v0.0.2/x.tgz";
    const tarball = await packTarball(channel.name, channel.version);
    const npm = npmStandIn({
      [channel.url]: new Error("npm error code EFETCH\nnpm error fetch failed"),
      [mirrorUrl]: { integrity: digest(tarball) },
    });
    const installed = await installPluginChannel(
      root,
      { ...channel, integrity: digest(tarball), mirrors: [mirrorUrl] },
      { install: npm.install, uninstall: npm.uninstall },
    );
    expect(installed).toEqual({ name: channel.name, version: channel.version });
    expect(npm.specs).toEqual([channel.url, mirrorUrl]);
    expect(npm.uninstalls).toEqual([]);
  });
});

describe("installPluginChannel, the default download path (the server fetches the asset itself)", () => {
  /**
   * A stand-in for npm as the default path uses it: one `npm install` of the local tarball
   * per call, the spec read off the args (`install … -- ./archives/<file>`). It "unpacks"
   * by writing the entry's package into node_modules, so the post-check's manifest read has
   * something to read — as npm unpacking the verified bytes would. An Error stands for npm
   * failing on the local file, which nothing here does when the bytes verify.
   */
  const npmSpy = () => {
    const specs: string[] = [];
    const uninstalls: string[] = [];
    const windows: number[] = [];
    const run: NpmRun = async (prefix, args, _cwd, window) => {
      const spec = args[args.length - 1]!;
      specs.push(spec);
      windows.push(window ?? Number.NaN);
      await fs.mkdir(path.join(prefix, "node_modules", ...channel.name.split("/")), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(prefix, "node_modules", ...channel.name.split("/"), "package.json"),
        JSON.stringify({ name: channel.name, version: channel.version }),
      );
      return "";
    };
    const uninstall = async (_prefix: string, name: string) => {
      uninstalls.push(name);
    };
    return { run, uninstall, specs, uninstalls, windows };
  };

  /** Serves the given bytes for exactly the address asked, 404 for everything else. */
  const serve = (
    byUrl: Record<string, Uint8Array | ReadableStream<Uint8Array> | (() => Response)>,
  ): typeof fetch =>
    (async (input: unknown) => {
      const answer = byUrl[String(input)];
      if (answer === undefined) return new Response("no such address", { status: 404 });
      if (typeof answer === "function") return answer();
      if (answer instanceof ReadableStream) {
        return new Response(answer, { status: 200 });
      }
      return new Response(Buffer.from(answer), {
        status: 200,
        headers: { "content-length": String(answer.byteLength) },
      });
    }) as unknown as typeof fetch;

  it("downloads the asset itself, reports byte progress, and npm installs the local file", async () => {
    const root = await tempRoot();
    const bytes = await packTarball(channel.name, channel.version);
    const npm = npmSpy();
    const progress: Array<{ received: number; total: number | null }> = [];
    const installed = await installPluginChannel(root, { ...channel, integrity: digest(bytes) }, {
      npm: npm.run,
      fetch: serve({ [channel.url]: bytes }),
      uninstall: npm.uninstall,
      onProgress: (received, total) => progress.push({ received, total }),
    });
    expect(installed).toEqual({ name: channel.name, version: channel.version });
    // npm never saw the URL — it unpacked the already-verified local file.
    expect(npm.specs).toEqual([`./archives/${channel.name.replace(/[^a-zA-Z0-9._-]/g, "-")}-${channel.version}.tgz`]);
    // The window npm ran under is the local-install one (bytes already on disk), not a
    // network timer.
    expect(npm.windows).toEqual([300_000]);
    // The tarball is in the archives, the staging partial is gone.
    const prefix = pluginsPrefix(root);
    await fs.access(
      path.join(prefix, "archives", `${channel.name.replace(/[^a-zA-Z0-9._-]/g, "-")}-${channel.version}.tgz`),
    );
    await expect(fs.readdir(path.join(prefix, ".staging"))).resolves.toEqual([]);
    // Byte progress: a first event at zero, the completion carrying the real total.
    expect(progress[0]).toEqual({ received: 0, total: bytes.byteLength });
    expect(progress.at(-1)).toEqual({ received: bytes.byteLength, total: bytes.byteLength });
    expect(npm.uninstalls).toEqual([]);
  });

  it("a stalled download is cut and the next address serves the bytes", async () => {
    const root = await tempRoot();
    const stalledUrl = "https://github.com/o/r/releases/download/v0.0.2/stalled.tgz";
    const mirrorUrl = "https://cdn-mirror.example/o/r/releases/download/v0.0.2/stalled.tgz";
    const bytes = await packTarball(channel.name, channel.version);
    const npm = npmSpy();
    const tried: string[] = [];
    // The first address delivers a header and three bytes, then goes quiet: it is cut at
    // the stall window, and the mirror carries the whole file.
    const baseFetch = serve({
      [stalledUrl]: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([1, 2, 3]));
        },
      }),
      [mirrorUrl]: bytes,
    });
    const fetch: typeof globalThis.fetch = (input, init) => {
      tried.push(String(input));
      return baseFetch(input, init);
    };
    const installed = await installPluginChannel(
      root,
      { ...channel, url: stalledUrl, integrity: digest(bytes), mirrors: [mirrorUrl] },
      { npm: npm.run, fetch, uninstall: npm.uninstall, stallMs: 50 },
    );
    expect(installed).toEqual({ name: channel.name, version: channel.version });
    expect(tried).toEqual([stalledUrl, mirrorUrl]);
    // One local install, of the file the mirror's download verified.
    expect(npm.specs).toEqual([`./archives/${channel.name.replace(/[^a-zA-Z0-9._-]/g, "-")}-${channel.version}.tgz`]);
    expect(npm.uninstalls).toEqual([]);
  });

  it("a slow-but-steady download that outlasts stallMs finishes without being cut", async () => {
    const root = await tempRoot();
    const bytes = await packTarball(channel.name, channel.version);
    const npm = npmSpy();
    const progress: Array<{ received: number; total: number | null }> = [];
    // Four chunks spaced 30 ms apart (120 ms total) with an 80 ms stall window: each chunk
    // resets the watchdog, so the slow stream completes intact.
    const parts = 4;
    const size = Math.ceil(bytes.byteLength / parts);
    const fetch = serve({
      [channel.url]: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async start(c) {
              for (let i = 0; i < bytes.byteLength; i += size) {
                await new Promise((r) => setTimeout(r, 30));
                c.enqueue(bytes.subarray(i, Math.min(i + size, bytes.byteLength)));
              }
              c.close();
            },
          }),
          { status: 200, headers: { "content-length": String(bytes.byteLength) } },
        ),
    });
    const installed = await installPluginChannel(root, { ...channel, integrity: digest(bytes) }, {
      npm: npm.run,
      fetch,
      uninstall: npm.uninstall,
      stallMs: 80,
      onProgress: (received, total) => progress.push({ received, total }),
    });
    expect(installed).toEqual({ name: channel.name, version: channel.version });
    expect(progress[0]).toEqual({ received: 0, total: bytes.byteLength });
    expect(progress.at(-1)).toEqual({ received: bytes.byteLength, total: bytes.byteLength });
  });

  it("bytes that do not match the entry's sha512 never reach npm — the address is refused", async () => {
    const root = await tempRoot();
    const npm = npmSpy();
    await expect(
      installPluginChannel(root, channel, {
        npm: npm.run,
        fetch: serve({ [channel.url]: new TextEncoder().encode("tampered bytes") }),
        uninstall: npm.uninstall,
      }),
    ).rejects.toThrow(/does not match the sha512/);
    expect(npm.specs).toEqual([]);
    expect(npm.uninstalls).toEqual([]);
    const prefix = pluginsPrefix(root);
    await expect(fs.readdir(path.join(prefix, "archives"))).resolves.toEqual([]);
    await expect(fs.readdir(path.join(prefix, ".staging"))).resolves.toEqual([]);
  });

  it("an entry whose pin is not a sha512 digest refuses before anything is fetched", async () => {
    const root = await tempRoot();
    const npm = npmSpy();
    const fetchSpy = vi.fn<typeof fetch>();
    await expect(
      installPluginChannel(
        root,
        { ...channel, integrity: "md5-abc" },
        { npm: npm.run, fetch: fetchSpy, uninstall: npm.uninstall },
      ),
    ).rejects.toThrow(/pins no readable sha512/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(npm.specs).toEqual([]);
    expect(npm.uninstalls).toEqual([]);
  });
});

describe("indexChannelOf", () => {
  const entry = (over: Partial<IndexDocumentEntry>): IndexDocumentEntry => ({
    name: "@penguinharness/language-typst",
    version: "0.0.2",
    description: "Typst highlighting.",
    authors: ["Example"],
    license: "MIT",
    ...over,
  });

  it("hands over the channel of an entry that pins one", () => {
    expect(
      indexChannelOf(
        entry({
          integrity,
          channels: [{ kind: "github", url: channel.url }],
        }),
      ),
    ).toEqual({ channel, fault: null });
  });

  it("refuses an entry whose github channel pins no integrity, with the reason", () => {
    const resolved = indexChannelOf(entry({ channels: [{ kind: "github", url: channel.url }] }));
    expect(resolved.channel).toBeNull();
    expect(resolved.fault).toMatch(/pins no sha512 integrity/);
  });

  it("answers no channel, without a fault, for an entry without a github channel", () => {
    expect(indexChannelOf(entry({ channels: [{ kind: "npm", url: "https://x" }] }))).toEqual({
      channel: null,
      fault: null,
    });
    expect(indexChannelOf(entry({}))).toEqual({ channel: null, fault: null });
  });

  it("takes plain http from the loopback only — a self-hosted index serving its own assets — and refuses it elsewhere", () => {
    const loopback = indexChannelOf(
      entry({ integrity, channels: [{ kind: "github", url: "http://127.0.0.1:9/asset.tgz" }] }),
    );
    expect(loopback.fault).toBeNull();
    expect(loopback.channel?.url).toBe("http://127.0.0.1:9/asset.tgz");
    expect(
      indexChannelOf(
        entry({ integrity, channels: [{ kind: "github", url: "http://example.com/asset.tgz" }] }),
      ).fault,
    ).toMatch(/not an https link/);
  });
});

describe("indexChannelLookup", () => {
  const index = [entry()];

  function entry(): IndexDocumentEntry {
    return {
      name: "@penguinharness/language-typst",
      version: "0.0.2",
      description: "Typst highlighting.",
      authors: ["Example"],
      license: "MIT",
      integrity,
      channels: [{ kind: "github", url: channel.url }],
    };
  }

  it("answers an entry's channel from the published index, fetched once per TTL", async () => {
    const fetchImpl = vi.fn(async () => Response.json(index));
    let time = 0;
    const lookup = indexChannelLookup(() => ["https://registry.example/index.json"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => time,
    });
    expect(await lookup("@penguinharness/language-typst")).toEqual({ channel, fault: null });
    expect(await lookup("@penguinharness/language-typst")).toEqual({ channel, fault: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    time = 31 * 60_000;
    await lookup("@penguinharness/language-typst");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("answers no channel when the index is down, so npm's failure stands", async () => {
    const lookup = indexChannelLookup(() => ["https://registry.example/index.json"], {
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    expect(await lookup("@penguinharness/language-typst")).toEqual({ channel: null, fault: null });
  });

  it("the first source to register a name provides it; a later source's same-name rows add nothing", async () => {
    // The second source lists the same package newer, with its own channel and integrity:
    // the first registration wins whole, so neither its rows nor its channel reach the pool.
    const later = [
      {
        ...entry(),
        version: "0.0.3",
        channels: [
          {
            kind: "github" as const,
            url: "https://github.com/o/later/releases/download/v0.0.3/x.tgz",
          },
        ],
      },
      { ...entry(), name: "@penguinharness/second-only" },
    ];
    const fetchImpl = vi.fn(async (input: unknown) =>
      String(input).startsWith("https://first.example/")
        ? Response.json([entry()])
        : Response.json(later),
    );
    let time = 0;
    const lookup = indexChannelLookup(
      () => ["https://first.example/index.json", "https://second.example/index.json"],
      { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => time },
    );
    expect(await lookup("@penguinharness/language-typst")).toEqual({ channel, fault: null });
    // A version only the later source carries is not in the merged pool: the first
    // registration's rows are the package's rows.
    const miss = await lookup("@penguinharness/language-typst", "0.0.3");
    expect(miss.channel).toBeNull();
    expect(miss.fault).toMatch(/no version of it matches 0\.0\.3/);
    // A package the first source does not list comes from the second: its channel names the
    // entry that declares it.
    expect(await lookup("@penguinharness/second-only")).toEqual({
      channel: { ...channel, name: "@penguinharness/second-only" },
      fault: null,
    });
  });

  it("the owning source's own several versions all stay in the pool", async () => {
    // The first source lists two versions of the package; the second lists the name newer.
    // Every version the first registration carries answers, and "newest" stays inside it.
    const older = { ...entry(), version: "0.0.1" };
    const later = [{ ...entry(), version: "9.9.9" }];
    const fetchImpl = vi.fn(async (input: unknown) =>
      String(input).startsWith("https://first.example/")
        ? Response.json([older, entry()])
        : Response.json(later),
    );
    let time = 0;
    const lookup = indexChannelLookup(
      () => ["https://first.example/index.json", "https://second.example/index.json"],
      { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => time },
    );
    // No version: the owning source's newest row — the later source's 9.9.9 never joins.
    expect(await lookup("@penguinharness/language-typst")).toEqual({
      channel: { ...channel, version: "0.0.2" },
      fault: null,
    });
    // A pinned older version resolves inside the owning source's rows.
    expect(await lookup("@penguinharness/language-typst", "0.0.1")).toEqual({
      channel: { ...channel, version: "0.0.1" },
      fault: null,
    });
  });

  it("answers no channel when no published index is configured", async () => {
    const lookup = indexChannelLookup(() => []);
    expect(await lookup("@penguinharness/language-typst")).toEqual({ channel: null, fault: null });
  });
});

describe("npm first, the channel only on its failure (the route's install)", () => {
  const spec = {
    kind: "name" as const,
    spec: "@penguinharness/language-typst",
    name: "@penguinharness/language-typst",
    version: "0.0.2",
  };

  /** npm's failure as installNamedOrChanneled sees it: a message, and the bucket npm's stderr sorted it into. */
  const npmSays = (message: string, reason: "unavailable" | "other") => {
    const err = new PluginInstallError(message);
    err.reason = reason;
    throw err;
  };

  it("a name npm installs never consults the index", async () => {
    const channelOf = vi.fn();
    const installChannel = vi.fn();
    const installed = await installNamedOrChanneled("/root", spec, {
      install: async () => ({ name: spec.name, version: "1.0.0" }),
      channelOf,
      installChannel,
    });
    expect(installed).toEqual({ name: spec.name, version: "1.0.0" });
    expect(channelOf).not.toHaveBeenCalled();
    expect(installChannel).not.toHaveBeenCalled();
  });

  it("a name npm has no answer for (E404) falls through to the index channel, with the requested version", async () => {
    const channelOf = vi.fn(async () => ({ channel, fault: null }));
    const installChannel = vi.fn(async () => ({ name: channel.name, version: channel.version }));
    const installed = await installNamedOrChanneled("/root", spec, {
      install: async () =>
        npmSays(
          "404 Not Found - GET https://registry.npmjs.org/@penguinharness%2flanguage-typst",
          "unavailable",
        ),
      channelOf,
      installChannel,
    });
    expect(installed).toEqual({ name: channel.name, version: channel.version });
    expect(channelOf).toHaveBeenCalledWith(spec.name, spec.version);
    // No progress was asked for, and none is passed on: the channel install still gets the
    // opts, so it knows nothing was riding along.
    expect(installChannel).toHaveBeenCalledWith("/root", channel, { onProgress: undefined });
  });

  it("a download's progress rides to the channel install, never to npm", async () => {
    const channelOf = vi.fn(async () => ({ channel, fault: null }));
    const installChannel = vi.fn(async () => ({ name: channel.name, version: channel.version }));
    const onProgress = vi.fn();
    await installNamedOrChanneled("/root", spec, {
      install: async () => npmSays("npm said: not found", "unavailable"),
      channelOf,
      installChannel,
      onProgress,
    });
    expect(installChannel).toHaveBeenCalledWith("/root", channel, { onProgress });
  });

  it("an npm failure that is not 'unavailable' does not fall through — a channel is not the answer to it", async () => {
    const channelOf = vi.fn();
    const installChannel = vi.fn();
    await expect(
      installNamedOrChanneled("/root", spec, {
        install: async () => npmSays("npm error lifecycle script failed", "other"),
        channelOf,
        installChannel,
      }),
    ).rejects.toThrow(/lifecycle script failed/);
    expect(channelOf).not.toHaveBeenCalled();
    expect(installChannel).not.toHaveBeenCalled();
  });

  it("an index with no channel for the name refuses, naming both answers", async () => {
    await expect(
      installNamedOrChanneled("/root", spec, {
        install: async () => npmSays("npm said: not found", "unavailable"),
        channelOf: async () => ({ channel: null, fault: null }),
        installChannel: vi.fn(),
      }),
    ).rejects.toThrow(
      /npm said: not found\. The published plugin index lists no installable github channel/,
    );
  });

  it("a channel listed without an integrity refuses with the reason, not an install", async () => {
    const installChannel = vi.fn();
    await expect(
      installNamedOrChanneled("/root", spec, {
        install: async () => npmSays("npm said: not found", "unavailable"),
        channelOf: async () => ({
          channel: null,
          fault:
            "@penguinharness/language-typst's index entry lists a github release channel but pins no sha512 integrity, so its bytes cannot be verified; it is not installable.",
        }),
        installChannel,
      }),
    ).rejects.toThrow(/pins no sha512 integrity/);
    expect(installChannel).not.toHaveBeenCalled();
  });

  it("a failing channel keeps npm's word and adds the channel's", async () => {
    await expect(
      installNamedOrChanneled("/root", spec, {
        install: async () => npmSays("npm said: not found", "unavailable"),
        channelOf: async () => ({ channel, fault: null }),
        installChannel: async () => {
          throw new PluginInstallError("the release asset answered 404: " + channel.url);
        },
      }),
    ).rejects.toThrow(/npm said: not found\. Its index channel: the release asset answered 404/);
  });
});
