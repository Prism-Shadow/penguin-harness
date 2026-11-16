/**
 * Installing a plugin through the published index's github release channel
 * (plugin/install.ts installPluginChannel, plugin/registry.ts indexChannelLookup +
 * indexChannelOf, and the install route's npm-first fallthrough):
 *
 * - The channel's release URL is a spec npm natively understands, so each address's attempt
 *   is npm itself installing it; what npm actually installed is verified after the fact —
 *   the lockfile entry's integrity against the sha512 the entry pins, the installed
 *   manifest against the entry's name and version.
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
  PluginInstallError,
  pluginsPrefix,
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
      { ...entry(), version: "0.0.3", channels: [{ kind: "github" as const, url: "https://github.com/o/later/releases/download/v0.0.3/x.tgz" }] },
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
