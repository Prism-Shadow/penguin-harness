/**
 * The six distro channels (PRFC-0021) against PRFC-0023's floor: a root provisioned by any
 * channel holds a harness record, and the CLI that runs against it reads a bundle out of
 * that record — its own entry beside it. Each channel is exercised the way its code paths
 * provision: a hot push (npm, tarball, Docker: a server running there was pushed), a
 * release's shipped image (tarball install of a release nothing was pushed to), a checkout's
 * image (machines installed from a dev server), and a peer's copied state (machines-installed).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HmrHost } from "@prismshadow/penguin-hmr";
import type { PlatformBundle } from "@prismshadow/penguin-hmr";
import { readHarnessMeta, readHarnessInfo } from "../src/hmr/manifest.js";
import { writePushedBuild } from "../src/hmr/pushed-build.js";
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

const PACKAGED: PlatformBundle = {
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
} as unknown as PlatformBundle;

/** A hot push through the layer's own host: the provisioning npm, tarball and Docker share. */
async function pushThroughHost(root: string): Promise<void> {
  const host = new HmrHost(root, PACKAGED);
  try {
    const outcome = await host.upgradeAll({ platform: PLATFORM_SOURCE, cli: CLI, web: WEB });
    expect(outcome).toMatchObject({ status: "ok", persisted: true });
  } finally {
    host.dispose();
  }
}

/** An install image: the body a release ships (or a checkout builds), laid down as a store. */
async function layInstallImage(root: string): Promise<void> {
  await writePushedBuild(
    path.join(root, "hmr"),
    { platform: PLATFORM, cli: CLI, web: { files: WEB } },
    new Date(0),
  );
}

/** A peer's copied state: the same bytes an install streams across (harness.json + store/). */
async function copyPeerState(fromRoot: string, toRoot: string): Promise<void> {
  await fs.cp(path.join(fromRoot, "hmr"), path.join(toRoot, "hmr"), { recursive: true });
}

describe("every channel's root holds a harness record, and its CLI reads one", () => {
  for (const channel of ["npm", "tarball-push", "docker", "desktop-push"] as const) {
    it(`hot push provisions ${channel}: record, version report, and a CLI answer`, async () => {
      const root = await tmp(`penguin-channel-${channel}-`);
      await pushThroughHost(root);

      // The record: one affirmative answer, the manifest itself.
      const meta = await readHarnessMeta(root);
      expect(meta.kind).toBe("meta");
      if (meta.kind !== "meta") return;
      expect(meta.manifest.cli?.bundle).toMatch(/^store\/cli\/[0-9a-f]+\.mjs$/);
      expect(meta.manifest.platform?.bundle).toMatch(/^store\/platform\//);

      // The bundle the record names is on disk, and is the CLI that was pushed.
      const cliBundle = await fs.readFile(
        path.join(root, "hmr", meta.manifest.cli!.bundle!),
        "utf8",
      );
      expect(cliBundle).toBe(CLI);
      // The version report face degrades to nothing.
      expect(await readHarnessInfo(root)).toMatchObject({ bundles: { cli: expect.any(String) } });

      // The CLI that runs against this root: its own entry, with the record's bundle.
      const answer = await resolveCli({ callerEntry: "/install/dist/penguin.js", root });
      expect(answer).toEqual({
        kind: "entry",
        entry: "/install/dist/penguin.js",
        reason: "own-entry",
        bundle: path.join(root, "hmr", meta.manifest.cli!.bundle!),
      });
    });
  }

  it("a release's shipped image provisions its install: record and CLI answer", async () => {
    const root = await tmp("penguin-channel-tarball-release-");
    await layInstallImage(root);

    const meta = await readHarnessMeta(root);
    expect(meta.kind).toBe("meta");
    if (meta.kind !== "meta") return;
    expect(meta.manifest.cli?.bundle).toMatch(/^store\/cli\//);

    const answer = await resolveCli({ callerEntry: "/install/lib/dist/penguin.js", root });
    expect(answer).toMatchObject({ kind: "entry", reason: "own-entry" });
    if (answer.kind === "entry") expect(answer.bundle).toContain("store/cli/");
  });

  it("a checkout's image provisions a machines install the same way", async () => {
    const root = await tmp("penguin-channel-checkout-image-");
    await layInstallImage(root);

    const meta = await readHarnessMeta(root);
    expect(meta.kind).toBe("meta");
    if (meta.kind !== "meta") return;
    // The image carries the provenance its builder wrote, so the far side reports a version.
    expect(await readHarnessInfo(root)).toMatchObject({ bundles: { cli: expect.any(String) } });

    const answer = await resolveCli({ callerEntry: "/install/lib/dist/penguin.js", root });
    expect(answer).toMatchObject({ kind: "entry", reason: "own-entry" });
  });

  it("a machines-installed peer copies the sender's record, and its CLI reads it", async () => {
    const senderRoot = await tmp("penguin-channel-peer-sender-");
    await pushThroughHost(senderRoot);
    const peerRoot = await tmp("penguin-channel-peer-receiver-");
    await copyPeerState(senderRoot, peerRoot);

    // The peer holds the sender's record byte for byte — the copy-at-install behavior.
    const sender = await readHarnessMeta(senderRoot);
    const peer = await readHarnessMeta(peerRoot);
    expect(peer.kind).toBe("meta");
    if (peer.kind !== "meta" || sender.kind !== "meta") return;
    expect(peer.manifest).toEqual(sender.manifest);

    const answer = await resolveCli({ callerEntry: "/install/lib/dist/penguin.js", root: peerRoot });
    expect(answer).toMatchObject({
      kind: "entry",
      reason: "own-entry",
      bundle: path.join(peerRoot, "hmr", peer.manifest.cli!.bundle!),
    });
  });
});
