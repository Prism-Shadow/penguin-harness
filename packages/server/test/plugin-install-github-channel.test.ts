/**
 * Installing a plugin through the published index's github release channel
 * (plugin/install.ts installPluginChannel, plugin/registry.ts indexChannelLookup +
 * indexChannelOf, and the install route's npm-first fallthrough):
 *
 * - The channel's asset is fetched, verified against the sha512 the entry pins, and only the
 *   verified bytes are written — into the prefix's archives, installed as a `file:` record.
 * - A mismatch, an unreadable integrity, or a channel listed without an integrity refuses the
 *   install with the reason; nothing unverified installs.
 * - npm stays the first source: a name npm installs never consults the index, and a channel
 *   install is only the fallthrough for a name npm answered E404/ETARGET on (the version
 *   asked for goes with the lookup); any other npm failure stays a failure.
 * - The verified tarball's own package.json has to be the index entry's package and version
 *   before it installs under its digest-named archive; a different archive refuses with
 *   nothing written and npm never run.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginIndexEntry } from "../src/api/types.js";
import {
  cmdQuote,
  installPluginChannel,
  npmFailureKind,
  PluginInstallError,
  pluginsPrefix,
} from "../src/plugin/install.js";
import { indexChannelLookup, indexChannelOf, selectIndexChannel, type IndexChannel } from "../src/plugin/registry.js";
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
 * packed by the system tar, the same reader the install uses to check the manifest against
 * the index entry before anything installs.
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

describe("cmdQuote", () => {
  // The quoting is what keeps cmd.exe's metacharacters out of the line a Windows install
  // runs: a version string carrying a pipe, a URL carrying an ampersand, a name carrying a
  // caret or a redirect must all land as inert characters inside one pair of quotes.
  it("wraps an argument in quotes, so cmd's metacharacters stay inert", () => {
    expect(cmdQuote("pkg@1.0.0")).toBe('"pkg@1.0.0"');
    expect(cmdQuote("pkg@1.0.0|rm -rf /")).toBe('"pkg@1.0.0|rm -rf /"');
    expect(cmdQuote("https://github.com/o/r/releases/download/v1&calc")).toBe(
      '"https://github.com/o/r/releases/download/v1&calc"',
    );
    expect(cmdQuote("a^b>c<d")).toBe('"a^b>c<d"');
  });

  it("doubles an inner double quote, the only escape cmd.exe honors", () => {
    expect(cmdQuote('say "hi"')).toBe('"say ""hi"""');
  });
});

describe("installPluginChannel", () => {
  /**
   * What npm does for a real install, stood in here: it writes the package under the prefix
   * and records what it downloaded in the prefix's package-lock — with the `integrity` npm
   * itself computed over the bytes it fetched, which is what the install is verified
   * against. The spec npm was handed is remembered, too.
   */
  const fakeNpmInstall = (name: string, version: string, integrity?: string) => {
    const specs: string[] = [];
    const run = async (prefix: string, spec: string) => {
      specs.push(spec);
      const dir = path.join(prefix, "node_modules", ...name.split("/"));
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name, version }));
      const manifestPath = path.join(prefix, "package.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8").catch(() => "{}")) as {
        dependencies?: Record<string, string>;
      };
      manifest.dependencies = { ...(manifest.dependencies ?? {}), [name]: spec };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      const lockPath = path.join(prefix, "package-lock.json");
      const lock = JSON.parse(await fs.readFile(lockPath, "utf8").catch(() => "{}")) as {
        packages?: Record<string, { integrity?: string }>;
      };
      lock.packages = {
        ...(lock.packages ?? {}),
        [`node_modules/${name}`]: { integrity: integrity ?? digest(asset) },
      };
      await fs.writeFile(lockPath, JSON.stringify(lock, null, 2));
    };
    return { run, specs };
  };

  it("hands the channel URL to npm and verifies what npm settled against the entry's pin", async () => {
    const root = await tempRoot();
    const npm = fakeNpmInstall(channel.name, channel.version, integrity);
    const installed = await installPluginChannel(root, channel, { install: npm.run });
    expect(npm.specs).toEqual([channel.url]);
    expect(installed).toEqual({ name: channel.name, version: channel.version });
  });

  it("uninstalls and refuses when the lockfile's integrity differs from the pin", async () => {
    const root = await tempRoot();
    const other = digest(new TextEncoder().encode("bytes npm did fetch, not what the pin says"));
    const npm = fakeNpmInstall(channel.name, channel.version, other);
    await expect(
      installPluginChannel(root, channel, { install: npm.run }),
    ).rejects.toThrow(/does not match the sha512 the index entry pins.*uninstalled/s);
    // Nothing of the package is left for a later install to reconcile in.
    await expect(
      fs.access(path.join(pluginsPrefix(root), "node_modules", ...channel.name.split("/"))),
    ).rejects.toThrow();
    // The uninstall runs through npm's own uninstall line, not through the stand-in's run.
    expect(npm.specs).toEqual([channel.url]);
  });

  it("uninstalls and refuses when the lockfile records no integrity at all", async () => {
    const root = await tempRoot();
    const npm = fakeNpmInstall(channel.name, channel.version, undefined);
    // The stand-in records no integrity at all for this run.
    await expect(
      installPluginChannel(root, channel, {
        install: async (prefix, spec) => {
          await npm.run(prefix, spec);
          const lockPath = path.join(prefix, "package-lock.json");
          const lock = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
            packages?: Record<string, Record<string, unknown>>;
          };
          delete lock.packages![`node_modules/${channel.name}`]!.integrity;
          await fs.writeFile(lockPath, JSON.stringify(lock, null, 2));
        },
      }),
    ).rejects.toThrow(/records no integrity for/);
    await expect(
      fs.access(path.join(pluginsPrefix(root), "node_modules", ...channel.name.split("/"))),
    ).rejects.toThrow();
  });

  it("refuses an entry whose integrity npm's own shape cannot even describe, before npm runs", async () => {
    const root = await tempRoot();
    const install = vi.fn(async () => undefined);
    await expect(
      installPluginChannel(root, { ...channel, integrity: "md5-abc" }, { install }),
    ).rejects.toThrow(/not sha512-<base64>/);
    expect(install).not.toHaveBeenCalled();
  });

  it("uninstalls and refuses when npm settles on a version the entry does not publish", async () => {
    const root = await tempRoot();
    const npm = fakeNpmInstall(channel.name, "9.9.9", integrity);
    await expect(
      installPluginChannel(root, channel, { install: npm.run }),
    ).rejects.toThrow(/settled on "9\.9\.9".*not the 0\.0\.2/s);
    await expect(
      fs.access(path.join(pluginsPrefix(root), "node_modules", ...channel.name.split("/"))),
    ).rejects.toThrow();
  });
});


describe("indexChannelOf", () => {
  const entry = (over: Partial<PluginIndexEntry>): PluginIndexEntry => ({
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

  function entry(): PluginIndexEntry {
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
    const lookup = indexChannelLookup("https://registry.example/index.json", {
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

  it("a cold cache read by concurrent callers shares one fetch, and no late answer overwrites a newer one", async () => {
    let resolveFirst: ((res: Response) => void) | undefined;
    let calls = 0;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          calls += 1;
          if (calls === 1) resolveFirst = resolve as (res: Response) => void;
          else resolve(Response.json(index));
        }),
    );
    let time = 0;
    const lookup = indexChannelLookup("https://registry.example/index.json", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => time,
    });
    // Three cold-cache callers at once: one fetch carries them all.
    const first = lookup("@penguinharness/language-typst");
    const second = lookup("@penguinharness/language-typst");
    const third = lookup("@penguinharness/language-typst");
    await new Promise((r) => setTimeout(r, 0));
    resolveFirst!(Response.json(index));
    await Promise.all([first, second, third]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Past the TTL, a slow first refresh landing late must not overwrite the newer cache.
    time = 31 * 60_000;
    const stale = lookup("@penguinharness/language-typst");
    const fresh = lookup("@penguinharness/language-typst");
    await Promise.all([stale, fresh]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Well past the second refresh's own timestamp: the cache is stale again.
    time += 31 * 60_000;
    await lookup("@penguinharness/language-typst");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("answers no channel when the index is down, so npm's failure stands", async () => {
    const lookup = indexChannelLookup("https://registry.example/index.json", {
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    expect(await lookup("@penguinharness/language-typst")).toEqual({ channel: null, fault: null });
  });

  it("answers no channel when no published index is configured", async () => {
    const lookup = indexChannelLookup(null);
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
    expect(installChannel).toHaveBeenCalledWith("/root", channel);
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
