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
import {
  installPluginChannel,
  npmFailureKind,
  PluginInstallError,
  pluginsPrefix,
  verifyIntegrity,
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

describe("verifyIntegrity", () => {
  it("accepts the bytes the entry pins, answering the digest that names the archive", () => {
    expect(verifyIntegrity(asset, integrity)).toBe(integrity.slice("sha512-".length));
  });

  it("refuses a mismatch, saying the asset is not installed", () => {
    const other = new TextEncoder().encode("tampered bytes");
    expect(() => verifyIntegrity(other, integrity)).toThrow(PluginInstallError);
    expect(() => verifyIntegrity(other, integrity)).toThrow(/does not match the sha512/);
  });

  it("refuses an integrity that is not sha512-<base64>", () => {
    expect(() => verifyIntegrity(asset, "md5-abc")).toThrow(/not sha512-<base64>/);
  });
});

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
  /** What npm would record for a file: install — the record that keeps the tarball past a prune. */
  const fakeNpmInstall =
    (name: string, version: string) => async (prefix: string, spec: string) => {
      const dir = path.join(prefix, "node_modules", ...name.split("/"));
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name, version }));
      const manifestPath = path.join(prefix, "package.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8").catch(() => "{}")) as {
        dependencies?: Record<string, string>;
      };
      manifest.dependencies = {
        ...(manifest.dependencies ?? {}),
        [name]: `file:${spec.replace(/^\.\//, "")}`,
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    };

  it("fetches the asset, checks its manifest against the entry, and installs the verified tarball under its digest-named archive", async () => {
    const root = await tempRoot();
    const bytes = await packTarball(channel.name, channel.version);
    const pinned: IndexChannel = { ...channel, integrity: digest(bytes) };
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 }));
    const installedSpecs: string[] = [];
    const installed = await installPluginChannel(root, pinned, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      install: async (prefix, spec) => {
        installedSpecs.push(spec);
        // What npm would put on disk for the verified tarball. The prefix is created by
        // the install itself, and the fake receives it: node_modules sits inside it.
        await fakeNpmInstall(pinned.name, pinned.version)(prefix, spec);
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(pinned.url, { redirect: "follow" });
    expect(installed).toEqual({ name: pinned.name, version: pinned.version });
    // The tag is the digest's first sixteen file-safe characters: base64 carries `/` and
    // `+`, and neither belongs in a file name (a `/` would make the rename a subdirectory).
    const tag = (
      digest(bytes)
        .slice("sha512-".length)
        .match(/[A-Za-z0-9._~-]/g) ?? []
    )
      .slice(0, 16)
      .join("");
    const file = `@penguinharness-language-typst-0.0.2-${tag}.tgz`;
    expect(installedSpecs).toEqual([`./archives/${file}`]);
    // The archive the prefix keeps is the verified bytes, and nothing else is left behind
    // (the staging file the check read the manifest from is gone).
    const kept = await fs.readFile(path.join(pluginsPrefix(root), "archives", file));
    expect(new Uint8Array(kept)).toEqual(bytes);
    await expect(fs.readdir(path.join(pluginsPrefix(root), "archives"))).resolves.toEqual([file]);
  });

  it("refuses a tarball whose package.json is not the entry's package and version — npm never runs, nothing is written", async () => {
    const root = await tempRoot();
    const bytes = await packTarball("other-package", "9.9.9");
    const install = vi.fn(async () => undefined);
    await expect(
      installPluginChannel(
        root,
        { ...channel, integrity: digest(bytes) },
        {
          fetchImpl: (async () =>
            new Response(new Uint8Array(bytes), { status: 200 })) as unknown as typeof fetch,
          install,
        },
      ),
    ).rejects.toThrow(/package\.json says "other-package"@"9\.9\.9"/);
    expect(install).not.toHaveBeenCalled();
    await expect(fs.readdir(path.join(pluginsPrefix(root), "archives"))).resolves.toEqual([]);
  });

  it("refuses a mismatched asset before anything is written or installed", async () => {
    const root = await tempRoot();
    const wrong = new TextEncoder().encode("not what the index pinned");
    const install = vi.fn(async () => undefined);
    await expect(
      installPluginChannel(
        root,
        { ...channel, integrity: digest(wrong) },
        {
          fetchImpl: (async () =>
            new Response(new Uint8Array(asset), { status: 200 })) as unknown as typeof fetch,
          install,
        },
      ),
    ).rejects.toThrow(/does not match the sha512/);
    expect(install).not.toHaveBeenCalled();
  });

  it("refuses an asset URL that answers an error status", async () => {
    const root = await tempRoot();
    await expect(
      installPluginChannel(root, channel, {
        fetchImpl: (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch,
        install: async () => undefined,
      }),
    ).rejects.toThrow(/answered 404/);
  });

  it("reports the download as it is read, the total from the content-length", async () => {
    const root = await tempRoot();
    const bytes = await packTarball(channel.name, channel.version);
    const onProgress = vi.fn();
    await installPluginChannel(
      root,
      { ...channel, integrity: digest(bytes) },
      {
        fetchImpl: (async () =>
          new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { "content-length": String(bytes.length) },
          })) as unknown as typeof fetch,
        install: async () => undefined,
        onProgress,
      },
    );
    // Every call names the total, and the last one is the whole asset against it.
    expect(onProgress).toHaveBeenCalledWith(bytes.length, bytes.length);
    expect(onProgress.mock.calls.every((call) => call[1] === bytes.length)).toBe(true);
  });

  it("steps the report in percents of a known size, not once per chunk", async () => {
    const root = await tempRoot();
    const bytes = await packTarball(channel.name, channel.version);
    // The asset read in quarters: four reads, but a report only where a percent step is crossed.
    const quarter = Math.floor(bytes.length / 4);
    const pieces = [
      bytes.subarray(0, quarter),
      bytes.subarray(quarter, quarter * 2),
      bytes.subarray(quarter * 2, quarter * 3),
      bytes.subarray(quarter * 3),
    ];
    const onProgress = vi.fn();
    await installPluginChannel(
      root,
      { ...channel, integrity: digest(bytes) },
      {
        fetchImpl: (async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const piece of pieces) controller.enqueue(piece);
                controller.close();
              },
            }),
            { status: 200, headers: { "content-length": String(bytes.length) } },
          )) as unknown as typeof fetch,
        install: async () => undefined,
        onProgress,
      },
    );
    const received = onProgress.mock.calls.map((call) => call[0]);
    expect(received).toEqual([quarter, quarter * 2, quarter * 3, bytes.length, bytes.length]);
    expect(onProgress.mock.calls.every((call) => call[1] === bytes.length)).toBe(true);
  });

  it("reports a lengthless answer by mebibytes, the last call naming the whole asset", async () => {
    const root = await tempRoot();
    const bytes = await packTarball(channel.name, channel.version);
    const onProgress = vi.fn();
    await installPluginChannel(
      root,
      { ...channel, integrity: digest(bytes) },
      {
        fetchImpl: (async () =>
          new Response(new Uint8Array(bytes), { status: 200 })) as unknown as typeof fetch,
        install: async () => undefined,
        onProgress,
      },
    );
    // Well under a mebibyte, so no MiB step fires on the way: the read crosses none, and the
    // close of the read names the whole — the total the caller can show once it knows it.
    expect(onProgress.mock.calls).toEqual([
      [bytes.length, null],
      [bytes.length, bytes.length],
    ]);
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
