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
 *   install is only the fallthrough for a name npm has no answer for.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginIndexEntry } from "../src/api/types.js";
import {
  installPluginChannel,
  PluginInstallError,
  pluginsPrefix,
  verifyIntegrity,
} from "../src/plugin/install.js";
import {
  indexChannelLookup,
  indexChannelOf,
  type IndexChannel,
} from "../src/plugin/registry.js";
import { installNamedOrChanneled } from "../src/http/routes/plugins-installed.js";

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

const digest = (bytes: Uint8Array) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const asset = new TextEncoder().encode("a release tarball's bytes");
const integrity = digest(asset);

const channel: IndexChannel = {
  name: "@penguinharness/language-typst",
  version: "0.0.2",
  integrity,
  url: "https://github.com/o/r/releases/download/v0.0.2/x.tgz",
};

describe("verifyIntegrity", () => {
  it("accepts the bytes the entry pins", () => {
    expect(() => verifyIntegrity(asset, integrity)).not.toThrow();
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

describe("installPluginChannel", () => {
  it("fetches the asset, writes the verified bytes to the prefix's archives, and installs that tarball", async () => {
    const root = await tempRoot();
    const fetchImpl = vi.fn(async () => new Response(asset as unknown as BodyInit, { status: 200 }));
    const installedSpecs: string[] = [];
    const installed = await installPluginChannel(root, channel, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      install: async (prefix, spec) => {
        installedSpecs.push(spec);
        // What npm would put on disk for the verified tarball.
        const dir = path.join(pluginsPrefix(prefix), "node_modules", ...channel.name.split("/"));
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, "package.json"),
          JSON.stringify({ name: channel.name, version: channel.version }),
        );
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(channel.url, { redirect: "follow" });
    expect(installed).toEqual({ name: channel.name, version: channel.version });
    expect(installedSpecs).toEqual(["./archives/@penguinharness-language-typst-0.0.2.tgz"]);
    const kept = await fs.readFile(
      path.join(pluginsPrefix(root), "archives", "@penguinharness-language-typst-0.0.2.tgz"),
      "utf8",
    );
    expect(kept).toBe("a release tarball's bytes");
  });

  it("refuses a mismatched asset before anything is written or installed", async () => {
    const root = await tempRoot();
    const wrong = new TextEncoder().encode("not what the index pinned");
    const install = vi.fn(async () => undefined);
    await expect(
      installPluginChannel(root, { ...channel, integrity: digest(wrong) }, {
        fetchImpl: (async () => new Response(asset as unknown as BodyInit, { status: 200 })) as unknown as typeof fetch,
        install,
      }),
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
    const fetchImpl = vi.fn(async () =>
      Response.json(index),
    );
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
  const spec = { kind: "name" as const, spec: "@penguinharness/language-typst", name: "@penguinharness/language-typst", version: "0.0.2" };

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

  it("a name npm has no answer for falls through to the index channel", async () => {
    const installChannel = vi.fn(async () => ({ name: channel.name, version: channel.version }));
    const installed = await installNamedOrChanneled("/root", spec, {
      install: async () => {
        throw new PluginInstallError("404 Not Found - GET https://registry.npmjs.org/@penguinharness%2flanguage-typst");
      },
      channelOf: async () => ({ channel, fault: null }),
      installChannel,
    });
    expect(installed).toEqual({ name: channel.name, version: channel.version });
    expect(installChannel).toHaveBeenCalledWith("/root", channel);
  });

  it("an index with no channel for the name refuses, naming both answers", async () => {
    await expect(
      installNamedOrChanneled("/root", spec, {
        install: async () => {
          throw new PluginInstallError("npm said: not found");
        },
        channelOf: async () => ({ channel: null, fault: null }),
        installChannel: vi.fn(),
      }),
    ).rejects.toThrow(/npm said: not found\. The published plugin index lists no installable github channel/);
  });

  it("a channel listed without an integrity refuses with the reason, not an install", async () => {
    const installChannel = vi.fn();
    await expect(
      installNamedOrChanneled("/root", spec, {
        install: async () => {
          throw new PluginInstallError("npm said: not found");
        },
        channelOf: async () => ({
          channel: null,
          fault: "@penguinharness/language-typst's index entry lists a github release channel but pins no sha512 integrity, so its bytes cannot be verified; it is not installable.",
        }),
        installChannel,
      }),
    ).rejects.toThrow(/pins no sha512 integrity/);
    expect(installChannel).not.toHaveBeenCalled();
  });

  it("a failing channel keeps npm's word and adds the channel's", async () => {
    await expect(
      installNamedOrChanneled("/root", spec, {
        install: async () => {
          throw new PluginInstallError("npm said: not found");
        },
        channelOf: async () => ({ channel, fault: null }),
        installChannel: async () => {
          throw new PluginInstallError("the release asset answered 404: " + channel.url);
        },
      }),
    ).rejects.toThrow(/npm said: not found\. Its index channel: the release asset answered 404/);
  });
});
