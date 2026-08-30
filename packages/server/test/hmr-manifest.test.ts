/**
 * hmr/manifest.ts's resolveCliBundlePath: a plain disk reader `penguin-hmr` calls with no
 * running HmrHost (see packages/cli/src/penguin-hmr.ts). It must return null — never throw —
 * for every malformed or malicious harness.json, since a crash here breaks the CLI entirely.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readHarnessInfo, resolveCliBundlePath } from "../src/hmr/manifest.js";

async function makeRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "penguin-hmr-manifest-test-"));
}

async function writeManifest(root: string, manifest: unknown): Promise<void> {
  const hmrDir = path.join(root, "hmr");
  await fs.mkdir(hmrDir, { recursive: true });
  await fs.writeFile(path.join(hmrDir, "harness.json"), JSON.stringify(manifest));
}

describe("resolveCliBundlePath", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("returns null (not a throw) for a fresh root with no harness.json at all", async () => {
    root = await makeRoot();
    await expect(resolveCliBundlePath(root)).resolves.toBeNull();
  });

  it("returns null (not a throw) for `cli: {}` — no `bundle` key", async () => {
    root = await makeRoot();
    await writeManifest(root, { cli: {} });
    await expect(resolveCliBundlePath(root)).resolves.toBeNull();
  });

  it("returns null (not a throw) when `bundle` is not a string", async () => {
    root = await makeRoot();
    await writeManifest(root, { cli: { bundle: 42 } });
    await expect(resolveCliBundlePath(root)).resolves.toBeNull();
  });

  it("returns null (not a throw) when `bundle` is an empty string", async () => {
    root = await makeRoot();
    await writeManifest(root, { cli: { bundle: "" } });
    await expect(resolveCliBundlePath(root)).resolves.toBeNull();
  });

  it("returns null for a bundle path that escapes <root>/hmr/ via `..`", async () => {
    root = await makeRoot();
    // Plant a real file the escape would otherwise reach, to prove the guard — not the
    // file's mere non-existence — is what returns null.
    await fs.writeFile(path.join(root, "escaped.mjs"), "export const cli = async () => 0;\n");
    await writeManifest(root, { cli: { bundle: "../escaped.mjs" } });
    await expect(resolveCliBundlePath(root)).resolves.toBeNull();
  });

  it("returns null for an absolute bundle path (also an escape attempt)", async () => {
    root = await makeRoot();
    const outside = path.join(os.tmpdir(), "not-under-hmr.mjs");
    await fs.writeFile(outside, "export const cli = async () => 0;\n");
    try {
      await writeManifest(root, { cli: { bundle: outside } });
      await expect(resolveCliBundlePath(root)).resolves.toBeNull();
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it("resolves a legitimate, in-store bundle path", async () => {
    root = await makeRoot();
    const storeDir = path.join(root, "hmr", "store", "cli");
    await fs.mkdir(storeDir, { recursive: true });
    await fs.writeFile(path.join(storeDir, "abc123.mjs"), "export const cli = async () => 0;\n");
    await writeManifest(root, { cli: { bundle: "store/cli/abc123.mjs" } });
    const resolved = await resolveCliBundlePath(root);
    expect(resolved).toBe(path.join(root, "hmr", "store", "cli", "abc123.mjs"));
  });

  it("returns null when the referenced file does not exist (e.g. pruned)", async () => {
    root = await makeRoot();
    await writeManifest(root, { cli: { bundle: "store/cli/nonexistent.mjs" } });
    await expect(resolveCliBundlePath(root)).resolves.toBeNull();
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
