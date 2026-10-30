/**
 * hmr/manifest.ts's readers: readHarnessMeta, the one read of harness.json, and the faces
 * that project onto it — resolveCliBundlePath for the loader, readHarnessInfo for version
 * reporting. Every reader must degrade — answer, never throw — for every malformed
 * harness.json, since a crash here breaks the CLI entirely.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readHarnessInfo, readHarnessMeta, resolveCliBundlePath } from "../src/hmr/manifest.js";

async function makeRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "penguin-hmr-manifest-test-"));
}

async function writeManifest(root: string, manifest: unknown): Promise<void> {
  const hmrDir = path.join(root, "hmr");
  await fs.mkdir(hmrDir, { recursive: true });
  await fs.writeFile(path.join(hmrDir, "harness.json"), JSON.stringify(manifest));
}

describe("readHarnessMeta: nothing pushed and a record it cannot read are different answers", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("is `none` for a fresh root with no harness.json at all", async () => {
    root = await makeRoot();
    await expect(readHarnessMeta(root)).resolves.toEqual({ kind: "none" });
  });

  it("is `none` for a record that carries no committed version", async () => {
    root = await makeRoot();
    await writeManifest(root, { pushedAt: "2026-08-20T10:15:00.000Z" });
    await expect(readHarnessMeta(root)).resolves.toEqual({ kind: "none" });
  });

  it("is `broken`, naming the file, for a harness.json that will not parse", async () => {
    root = await makeRoot();
    await fs.mkdir(path.join(root, "hmr"), { recursive: true });
    await fs.writeFile(path.join(root, "hmr", "harness.json"), "{ not json");
    const meta = await readHarnessMeta(root);
    expect(meta.kind).toBe("broken");
    expect(meta.kind === "broken" && meta.reason).toMatch(/harness\.json is not readable JSON/);
  });

  it("is the record for a legitimate manifest, pointers and provenance as written", async () => {
    root = await makeRoot();
    const manifest = {
      platform: { bundle: "store/platform/dead00.mjs" },
      cli: { bundle: "store/cli/abc123.mjs" },
      web: { manifest: "store/web/cafe01.webz" },
      source: { repo: "https://example.com/penguin.git", revision: "v0.2.3-7-gabc1234-dirty" },
      pushedAt: "2026-08-20T10:15:00.000Z",
    };
    await writeManifest(root, manifest);
    await expect(readHarnessMeta(root)).resolves.toEqual({ kind: "meta", manifest });
  });
});

describe("resolveCliBundlePath: the CLI half of the record", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("is null for a root with nothing pushed", async () => {
    root = await makeRoot();
    await expect(resolveCliBundlePath(root)).resolves.toBeNull();
  });

  it("is null for a record with no `cli` entry — nothing pushed a CLI here", async () => {
    root = await makeRoot();
    await writeManifest(root, { platform: { bundle: "store/platform/abc.mjs" } });
    await expect(resolveCliBundlePath(root)).resolves.toBeNull();
  });

  it("is null, never a throw, for a harness.json that will not parse", async () => {
    root = await makeRoot();
    await fs.mkdir(path.join(root, "hmr"), { recursive: true });
    await fs.writeFile(path.join(root, "hmr", "harness.json"), "{ not json");
    await expect(resolveCliBundlePath(root)).resolves.toBeNull();
  });

  it("is null for a `cli` entry that names no usable bundle path", async () => {
    root = await makeRoot();
    for (const bundle of [42, "", undefined]) {
      await writeManifest(root, { cli: { bundle } });
      await expect(resolveCliBundlePath(root)).resolves.toBeNull();
    }
    await writeManifest(root, { cli: {} });
    await expect(resolveCliBundlePath(root)).resolves.toBeNull();
  });

  it("is null when the store lost the file (pruned)", async () => {
    root = await makeRoot();
    await writeManifest(root, { cli: { bundle: "store/cli/nonexistent.mjs" } });
    await expect(resolveCliBundlePath(root)).resolves.toBeNull();
  });

  it("resolves a legitimate, in-store path against <root>/hmr", async () => {
    root = await makeRoot();
    const storeDir = path.join(root, "hmr", "store", "cli");
    await fs.mkdir(storeDir, { recursive: true });
    await fs.writeFile(path.join(storeDir, "abc123.mjs"), "export const cli = async () => 0;\n");
    await writeManifest(root, { cli: { bundle: "store/cli/abc123.mjs" } });
    await expect(resolveCliBundlePath(root)).resolves.toBe(
      path.join(root, "hmr", "store", "cli", "abc123.mjs"),
    );
  });
});

/**
 * readHarnessInfo: the same disk, read for version reporting instead of for loading. It
 * feeds `penguin version --json` and GET /api/version, so like resolveCliBundlePath it must
 * degrade to missing fields rather than throw — a malformed store cannot be allowed to break
 * the command a user runs to find out what is wrong.
 */
describe("readHarnessInfo", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("returns null for a root with nothing ever pushed", async () => {
    root = await makeRoot();
    await expect(readHarnessInfo(root)).resolves.toBeNull();
  });

  it("returns null for a manifest carrying no artifact pointer at all", async () => {
    root = await makeRoot();
    await writeManifest(root, { pushedAt: "2026-08-20T10:15:00.000Z" });
    await expect(readHarnessInfo(root)).resolves.toBeNull();
  });

  it("reads provenance, commit time and all three bundle pointers", async () => {
    root = await makeRoot();
    await writeManifest(root, {
      platform: { bundle: "store/platform/dead00.mjs" },
      cli: { bundle: "store/cli/abc123.mjs" },
      web: { manifest: "store/web/cafe01.webz" },
      source: { repo: "https://example.com/penguin.git", revision: "v0.2.3-7-gabc1234-dirty" },
      pushedAt: "2026-08-20T10:15:00.000Z",
    });

    await expect(readHarnessInfo(root)).resolves.toEqual({
      source: { repo: "https://example.com/penguin.git", revision: "v0.2.3-7-gabc1234-dirty" },
      pushedAt: "2026-08-20T10:15:00.000Z",
      bundles: {
        platform: "store/platform/dead00.mjs",
        cli: "store/cli/abc123.mjs",
        web: "store/web/cafe01.webz",
      },
    });
  });

  it("reports a version pushed before provenance was recorded", async () => {
    // Every field a pusher may omit reads as null, so an older store still describes
    // which bundles are committed rather than reading as "nothing pushed".
    root = await makeRoot();
    await writeManifest(root, {
      platform: { bundle: "store/platform/dead00.mjs" },
      cli: { bundle: "store/cli/abc123.mjs" },
      web: { manifest: "store/web/cafe01.webz" },
    });

    const info = await readHarnessInfo(root);
    expect(info?.source).toBeNull();
    expect(info?.pushedAt).toBeNull();
    expect(info?.bundles.cli).toBe("store/cli/abc123.mjs");
  });

  it("drops a half-filled provenance rather than reporting half a source", async () => {
    root = await makeRoot();
    await writeManifest(root, {
      cli: { bundle: "store/cli/abc123.mjs" },
      source: { repo: "https://example.com/penguin.git" },
    });
    await expect(readHarnessInfo(root)).resolves.toMatchObject({ source: null });
  });

  it("drops wrong-typed fields instead of passing them through", async () => {
    root = await makeRoot();
    await writeManifest(root, {
      cli: { bundle: "store/cli/abc123.mjs" },
      source: { repo: 42, revision: ["nope"] },
      pushedAt: 1_755_000_000,
    });

    await expect(readHarnessInfo(root)).resolves.toEqual({
      source: null,
      pushedAt: null,
      bundles: { platform: null, cli: "store/cli/abc123.mjs", web: null },
    });
  });

  it("returns null (not a throw) for a truncated harness.json", async () => {
    root = await makeRoot();
    const hmrDir = path.join(root, "hmr");
    await fs.mkdir(hmrDir, { recursive: true });
    await fs.writeFile(path.join(hmrDir, "harness.json"), '{"cli": {"bundle":');
    await expect(readHarnessInfo(root)).resolves.toBeNull();
  });
});
