/**
 * Final update metadata, parsed as YAML against actual artifact bytes.
 * - Given matching version, exact installer entry and feed, valid publishers and blockmap,
 *   then acceptance succeeds without changing either installer or blockmap.
 * - Given stale hashes, sizes, paths, versions, extra entries or a changed feed, then it fails.
 * - Given missing/malformed publishers, YAML, installer or blockmap, then it fails closed.
 * - Given a blockmap made before final bytes changed, then matching SHA-512 alone cannot pass.
 * - Given valid artifacts, the public CLI also succeeds.
 */
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Build tooling is plain JavaScript, executed by Node 24.
import { verifyUpdateMetadata } from "../scripts/verify-update-metadata.mjs";
import { artifactFixture, buildBlockMap } from "./helpers/windows-artifacts.js";

const dirs: string[] = [];
async function fixture() {
  const result = await artifactFixture();
  dirs.push(result.root);
  return result;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Windows release update metadata", () => {
  it.each([
    { publisher: "Rotated Publisher" },
    { publisher: ["CN=Future Publisher, O=Future Publisher"] },
  ])(
    "accepts valid publisher metadata %j without pinning identity or changing signed bytes",
    async ({ publisher }) => {
      const { root, installer, bytes, sha512, config, save } = await fixture();
      config.publisherName = publisher;
      await save();
      const blockmap = await readFile(`${installer}.blockmap`);
      expect(await verifyUpdateMetadata(root)).toMatchObject({
        installer,
        sha512,
        size: bytes.length,
        blockmap: "matched",
      });
      expect(await readFile(installer)).toEqual(bytes);
      expect(await readFile(`${installer}.blockmap`)).toEqual(blockmap);
    },
  );

  it.each(["sha512", "path", "version"])("refuses stale top-level %s", async (key) => {
    const { root, latest, save } = await fixture();
    (latest as Record<string, unknown>)[key] = "stale";
    await save();
    await expect(verifyUpdateMetadata(root)).rejects.toThrow();
  });

  it.each(["sha512", "size", "url"])("refuses stale file entry %s", async (key) => {
    const { root, latest, save } = await fixture();
    (latest.files[0] as Record<string, unknown>)[key] = "stale";
    await save();
    await expect(verifyUpdateMetadata(root)).rejects.toThrow();
  });

  it.each([[], null, {}, [{ url: "other.exe" }]])(
    "refuses an inexact files list %j",
    async (files) => {
      const { root, latest, save } = await fixture();
      (latest as Record<string, unknown>).files = files;
      await save();
      await expect(verifyUpdateMetadata(root)).rejects.toThrow();
    },
  );

  it("refuses duplicate installer entries", async () => {
    const { root, latest, save } = await fixture();
    latest.files.push({ ...latest.files[0]! });
    await save();
    await expect(verifyUpdateMetadata(root)).rejects.toThrow("file count");
  });

  it.each([undefined, null, "", "  ", [], [""], [42], [null], ["Valid", " "], {}])(
    "refuses a disabled or malformed publisher field: %j",
    async (publisher) => {
      const { root, config, save } = await fixture();
      config.publisherName = publisher;
      await save();
      await expect(verifyUpdateMetadata(root)).rejects.toThrow("publisherName");
    },
  );

  it.each([
    ["provider", "generic"],
    ["owner", "other"],
    ["repo", "other"],
    ["host", "other.example"],
    ["url", "https://other.example"],
    ["channel", "other"],
    ["protocol", "http"],
  ])("refuses changed feed field %s", async (key, value) => {
    const { root, config, save } = await fixture();
    config[key!] = value;
    await save();
    await expect(verifyUpdateMetadata(root)).rejects.toThrow("feed");
  });

  it.each(["latest.yml", "win-unpacked/resources/app-update.yml"])(
    "refuses duplicate YAML keys in %s",
    async (file) => {
      const { root } = await fixture();
      const key = file === "latest.yml" ? "version" : "provider";
      const target = path.join(root, file);
      await writeFile(target, (await readFile(target, "utf8")) + `\n${key}: duplicate\n`);
      await expect(verifyUpdateMetadata(root)).rejects.toThrow();
    },
  );

  it.each(["latest.yml", "win-unpacked/resources/app-update.yml"])(
    "refuses malformed YAML in %s",
    async (file) => {
      const { root } = await fixture();
      await writeFile(path.join(root, file), "broken: [");
      await expect(verifyUpdateMetadata(root)).rejects.toThrow();
    },
  );

  it.each(["penguin-desktop-win32-x64.exe", "penguin-desktop-win32-x64.exe.blockmap"])(
    "refuses missing output %s",
    async (file) => {
      const { root } = await fixture();
      await rm(path.join(root, file));
      await expect(verifyUpdateMetadata(root)).rejects.toThrow();
    },
  );

  it.each(["stale", "corrupt"])(
    "refuses a %s blockmap even when installer hashes and size match",
    async (mode) => {
      const { root, installer } = await fixture();
      if (mode === "stale") {
        const other = path.join(root, "other.exe");
        await writeFile(other, "bytes from before signing");
        await buildBlockMap(other, "gzip", `${installer}.blockmap`);
      } else {
        await writeFile(`${installer}.blockmap`, "broken");
      }
      await expect(verifyUpdateMetadata(root)).rejects.toThrow();
    },
  );

  it("accepts final metadata through the actual CLI", async () => {
    const { root } = await fixture();
    const script = fileURLToPath(new URL("../scripts/verify-update-metadata.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, root], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ blockmap: "matched" });
  });
});
