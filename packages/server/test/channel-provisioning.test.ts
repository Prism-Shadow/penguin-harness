/** Carried-store lookup and reconciliation across npm, tarball and Docker layouts. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readHarnessInfo } from "../src/hmr/manifest.js";
import { readHarnessMeta } from "../src/harness-meta.js";
import { carriedBody, syncCarriedImage } from "../src/carried-image.js";
import { writePushedBuild } from "../src/hmr/pushed-build.js";
import type { PushedBuild } from "../src/hmr/pushed-build.js";
import { ShippedImage } from "../src/machines/shipped-image.js";
import { shippedImage } from "../src/machines/install-server.js";
import { resolveCli } from "../src/services/cli-shim.js";

const made: string[] = [];

async function tmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true });
  }
});

const CLI = "export async function cli(argv) { return 0; }\n";
const WEB = { "index.html": Buffer.from("<html></html>").toString("base64") };

/**
 * A minimal but bootable platform: hand-rolled any-schema context, park as the only
 * method — the least a bundle needs to pass the mechanism's floor. It travels as source
 * (what a push carries) and as the in-process object (the packaged default a fresh host
 * boots before any push), so the push's upgrade() sees the same method set on both sides.
 */
const PLATFORM_SOURCE = `
const anySchema = {
  strictParse: (doc) => ({ ok: true, value: doc === undefined ? {} : doc }),
  describe: () => ({ kind: "any" }),
};
const iface = {
  kind: "iface",
  name: "platform",
  version: 1,
  context: anySchema,
  methods: ["park"],
  children: {},
  migrations: {},
};
const impl = {
  create(_ctx, context) {
    return { park: () => context };
  },
};
export const hotPlatform = { id: "packaged", iface, impl, context: {} };
`;

const PACKAGED = {
  id: "packaged",
  iface: {
    kind: "iface",
    name: "platform",
    version: 1,
    context: {
      strictParse: (doc: unknown) => ({ ok: true as const, value: doc === undefined ? {} : doc }),
      describe: () => ({ kind: "any" }),
    },
    methods: ["park"],
    children: {},
    migrations: {},
  },
  impl: {
    create(_ctx: unknown, context: unknown) {
      return { park: () => context };
    },
  },
  context: {},
} as never;

/** A hot push through the layer's own host: the provisioning every pushed root has run. */
async function pushThroughHost(root: string, cli = CLI): Promise<void> {
  const { HmrHost } = await import("@prismshadow/penguin-hmr");
  const host = new HmrHost(root, PACKAGED);
  try {
    const outcome = await host.upgradeAll({ platform: PLATFORM_SOURCE, cli, web: WEB });
    expect(outcome).toMatchObject({ status: "ok", persisted: true });
  } finally {
    host.dispose();
  }
}

const BUILD: PushedBuild = {
  platform: PLATFORM_SOURCE,
  cli: CLI,
  web: { files: WEB },
  source: { repo: "https://github.com/Prism-Shadow/penguin-harness.git", revision: "vTEST" },
};

/** The store layout emitted by the packer's compiled writePushedBuild. */
async function packImage(dir: string, build = BUILD): Promise<string> {
  const store = path.join(dir, "hmr");
  await writePushedBuild(store, build, new Date(0));
  return store;
}

/** The answers every channel's provisioned root must satisfy. */
async function expectRecordAndAnswer(root: string): Promise<void> {
  const meta = await readHarnessMeta(root);
  expect(meta.kind).toBe("meta");
  if (meta.kind !== "meta") return;
  expect(meta.manifest.cli?.bundle).toMatch(/^store\/carried\/[0-9a-f]+\/cli\/[0-9a-f]+\.mjs$/);
  expect(meta.manifest.source).toMatchObject({ channel: "shipped-image" });

  const bundlePath = path.join(root, "hmr", meta.manifest.cli!.bundle!);
  expect(await fs.readFile(bundlePath, "utf8")).toBe(CLI);
  expect(await readHarnessInfo(root)).toMatchObject({ bundles: { cli: expect.any(String) } });

  const answer = await resolveCli({ callerEntry: "/install/dist/penguin.js", root });
  expect(answer).toEqual({
    kind: "entry",
    entry: "/install/dist/penguin.js",
    reason: "own-entry",
    bundle: bundlePath,
  });
}

describe("every channel's carried image provisions the root it serves", () => {
  for (const channel of ["npm", "tarball", "docker"] as const) {
    it(`${channel} ships a body its program finds, and a start copies it into any root`, async () => {
      // The body sits where that channel's packer put it; carriedBody() resolves it the
      // way the channel's own entry would — npm through the server package, the other
      // three beside their entry in dist/.
      const dist = await tmp(`penguin-channel-${channel}-dist-`);
      const body = await packImage(dist);
      const root = await tmp(`penguin-channel-${channel}-root-`);

      const outcome = await syncCarriedImage(root, body);
      expect(outcome).toMatchObject({ kind: "copied" });
      await expectRecordAndAnswer(root);

      // A different PENGUIN_HOME: the same program copies there too — the root is the
      // copy's address, not a fact learned at install time.
      const other = await tmp(`penguin-channel-${channel}-other-`);
      await expect(syncCarriedImage(other, body)).resolves.toMatchObject({ kind: "copied" });
      await expectRecordAndAnswer(other);
    });

    // The lookup that finds the body: a real layout on disk, the way each channel's
    // program is laid out — the entry beside its dist/, npm through the server package.
    it(`${channel} 's program layout resolves the body the packer wrote`, async () => {
      const program = await tmp(`penguin-channel-${channel}-program-`);
      const dist =
        channel === "npm"
          ? path.join(program, "node_modules", "@prismshadow", "penguin-cli", "dist")
          : path.join(program, channel === "docker" ? "opt/penguin/lib" : "lib", "dist");
      await fs.mkdir(dist, { recursive: true });
      await fs.writeFile(path.join(dist, "penguin.js"), "// entry\n");
      const server = path.join(program, "node_modules", "@prismshadow", "penguin-server");
      if (channel === "npm") {
        await fs.mkdir(path.join(server, "dist"), { recursive: true });
        await fs.writeFile(
          path.join(server, "package.json"),
          JSON.stringify({
            name: "@prismshadow/penguin-server",
            exports: { ".": "./dist/index.js" },
          }),
        );
        await fs.writeFile(path.join(server, "dist", "index.js"), "// server\n");
      }
      const store = await packImage(channel === "npm" ? path.join(server, "dist") : dist);
      expect(carriedBody(path.join(dist, "penguin.js"))).toBe(store);
      const root = await tmp(`penguin-layout-${channel}-root-`);
      await expect(
        syncCarriedImage(root, carriedBody(path.join(dist, "penguin.js"))),
      ).resolves.toMatchObject({ kind: "copied" });
      await expectRecordAndAnswer(root);

      // No body beside the entry: the lookup says so rather than guessing elsewhere.
      const bare = path.join(program, "lib", "bare");
      await fs.mkdir(bare, { recursive: true });
      await fs.writeFile(path.join(bare, "penguin.js"), "// entry\n");
      expect(carriedBody(path.join(bare, "penguin.js"))).toBeNull();
    });
  }
});

describe("the reconciliation is idempotent and defers to a push", () => {
  it("a second start over the same root copies nothing", async () => {
    const dist = await tmp("penguin-sync-current-dist-");
    const body = await packImage(dist);
    const root = await tmp("penguin-sync-current-root-");

    await expect(syncCarriedImage(root, body)).resolves.toMatchObject({ kind: "copied" });
    const record = path.join(root, "hmr", "harness.json");
    const before = await fs.stat(record);
    const bytes = await fs.readFile(record);
    // Every start after the first: no record rewrite or artifact copy.
    await expect(syncCarriedImage(root, body)).resolves.toMatchObject({ kind: "current" });
    expect(await fs.readFile(record)).toEqual(bytes);
    expect((await fs.stat(record)).mtimeMs).toBe(before.mtimeMs);
    await expectRecordAndAnswer(root);
  });

  it("an upgraded installation copies its newer body over the older image's record", async () => {
    const oldDist = await tmp("penguin-sync-upgrade-old-");
    const oldBody = await packImage(oldDist);
    const root = await tmp("penguin-sync-upgrade-root-");
    await syncCarriedImage(root, oldBody);

    // The "new" program carries a changed CLI — a genuinely different build, so the
    // record's bundle must rise to it.
    const newDist = await tmp("penguin-sync-upgrade-new-");
    const newerBody = await packImage(newDist, { ...BUILD, cli: CLI + "// v2\n" });
    await expect(syncCarriedImage(root, newerBody)).resolves.toMatchObject({ kind: "copied" });

    const meta = await readHarnessMeta(root);
    if (meta.kind === "meta") {
      const bundle = await fs.readFile(path.join(root, "hmr", meta.manifest.cli!.bundle!), "utf8");
      expect(bundle).toBe(CLI + "// v2\n");
    }
  });

  it("a hot-pushed root keeps its record: the copy never outlives a push", async () => {
    const dist = await tmp("penguin-sync-pushed-dist-");
    const body = await packImage(dist);
    const root = await tmp("penguin-sync-pushed-root-");
    await pushThroughHost(root, "export async function cli() { return 42; }\n");

    const bytes = await fs.readFile(path.join(root, "hmr", "harness.json"));
    const before = await readHarnessMeta(root);
    expect(before.kind).toBe("meta");

    await expect(syncCarriedImage(root, body)).resolves.toMatchObject({
      kind: "kept",
      reason: "pushed",
    });

    const after = await readHarnessMeta(root);
    expect(after).toEqual(before);
    expect(await fs.readFile(path.join(root, "hmr", "harness.json"))).toEqual(bytes);
    // And the pushed CLI, not the carried one, is what the record resolves.
    if (after.kind === "meta") {
      const bundle = await fs.readFile(path.join(root, "hmr", after.manifest.cli!.bundle!), "utf8");
      expect(bundle).toBe("export async function cli() { return 42; }\n");
    }
  });

  it("an unreadable record is left alone, and a start without a body does nothing", async () => {
    const dist = await tmp("penguin-sync-broken-dist-");
    const body = await packImage(dist);
    const root = await tmp("penguin-sync-broken-root-");
    await fs.mkdir(path.join(root, "hmr"), { recursive: true });
    await fs.writeFile(path.join(root, "hmr", "harness.json"), "{ not json");

    await expect(syncCarriedImage(root, body)).resolves.toMatchObject({
      kind: "kept",
      reason: "unreadable-record",
    });
    expect((await readHarnessMeta(root)).kind).toBe("broken");
    expect(await fs.readFile(path.join(root, "hmr", "harness.json"), "utf8")).toBe("{ not json");

    await expect(syncCarriedImage(root, null)).resolves.toMatchObject({
      kind: "absent",
      reason: "no-body",
    });
  });

  it("a peer's copied state provisions the receiving root as-is, no copy of ours over it", async () => {
    const senderRoot = await tmp("penguin-channel-peer-sender-");
    await pushThroughHost(senderRoot);
    const peerRoot = await tmp("penguin-channel-peer-receiver-");
    await fs.cp(path.join(senderRoot, "hmr"), path.join(peerRoot, "hmr"), { recursive: true });

    const sender = await readHarnessMeta(senderRoot);
    const peer = await readHarnessMeta(peerRoot);
    expect(peer.kind).toBe("meta");
    if (peer.kind !== "meta" || sender.kind !== "meta") return;
    expect(peer.manifest).toEqual(sender.manifest);

    const answer = await resolveCli({
      callerEntry: "/install/lib/dist/penguin.js",
      root: peerRoot,
    });
    expect(answer).toMatchObject({
      kind: "entry",
      reason: "own-entry",
      bundle: path.join(peerRoot, "hmr", peer.manifest.cli!.bundle!),
    });

    // A start on the peer — if its program carries a body — defers: the sender's pushed
    // record has no mark of ours.
    const bytes = await fs.readFile(path.join(peerRoot, "hmr", "harness.json"));
    const dist = await tmp("penguin-channel-peer-body-");
    await expect(syncCarriedImage(peerRoot, await packImage(dist))).resolves.toMatchObject({
      kind: "kept",
      reason: "pushed",
    });
    expect(await fs.readFile(path.join(peerRoot, "hmr", "harness.json"))).toEqual(bytes);
  });

  it("a record laid down as a checkout/release install image is a meta the CLI answers", async () => {
    // The writer an install (writePushedBuild) uses is the one the copy uses, so a root
    // provisioned by any writer answers the same. This is the release-tarball-installs-
    // from-image path machines-api exercises end to end.
    const root = await tmp("penguin-channel-image-");
    await writePushedBuild(path.join(root, "hmr"), BUILD, new Date(0));
    const meta = await readHarnessMeta(root);
    expect(meta.kind).toBe("meta");
    if (meta.kind === "meta") {
      expect(await fs.readFile(path.join(root, "hmr", meta.manifest.cli!.bundle!), "utf8")).toBe(
        CLI,
      );
    }
    const answer = await resolveCli({ callerEntry: "/install/lib/dist/penguin.js", root });
    expect(answer).toMatchObject({ kind: "entry", reason: "own-entry" });
  });
});

describe("store image consumers", () => {
  it("source checkout lookup has no carried store", async () => {
    const checkout = await tmp("penguin-channel-checkout-");
    expect(carriedBody(path.join(checkout, "src", "index.ts"))).toBeNull();
  });

  it("machine installs use the shared carried-store lay-down", async () => {
    const program = await tmp("penguin-store-machine-");
    const lib = path.join(program, "lib");
    const store = await packImage(path.join(lib, "dist"));
    await fs.writeFile(path.join(lib, "package.json"), JSON.stringify({ version: "0.2.16" }));
    expect(shippedImage(path.join(lib, "dist", "penguin.js"))).toEqual({
      baseVersion: "0.2.16",
      body: store,
    });
    const root = await tmp("penguin-store-machine-root-");
    const image = new ShippedImage(path.join(root, "release-image"), "0.2.16", store);
    const ready = await image.ready();
    expect(ready.ok).toBe(true);
    if (!ready.ok || ready.plan.hmrDir === null) return;
    await expectRecordAndAnswer(path.dirname(ready.plan.hmrDir));
    expect(await image.ready()).toEqual(ready);
  });
});
