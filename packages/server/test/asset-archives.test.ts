/**
 * Pushed assets travel as archives: the deploy packs each package into one deterministic
 * `.tgz` (the same files give the same bytes, so an unchanged package is an unchanged blob), and
 * the platform unpacks `archives/` once into `.unpacked/` before resolving from it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UNPACKED_DIR, unpackedAssetsDir } from "../src/hmr/asset-archives.js";
// @ts-expect-error — a plain .mjs build script, no declarations.
import { archiveName, packArchive } from "../../../scripts/asset-archives.mjs";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "asset-archives-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function source(
  files: Record<string, string>,
): Promise<Array<{ rel: string; abs: string; exec: boolean }>> {
  const src = path.join(dir, "src");
  const out = [];
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(src, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, text);
    out.push({ rel, abs, exec: rel.endsWith("helper") });
  }
  return out;
}

describe("asset archives", () => {
  it("packs deterministically, and names a scoped package flat", async () => {
    const entries = await source({
      "node_modules/a/b.js": "b",
      "node_modules/a/package.json": "{}",
    });
    const first = (await packArchive(entries)) as Buffer;
    await new Promise((r) => setTimeout(r, 1100)); // a later mtime on disk must not show
    const second = (await packArchive([...entries].reverse())) as Buffer;
    expect(first.equals(second)).toBe(true);
    expect(archiveName("plugins.", "@scope/name")).toBe("plugins.scope__name.tgz");
  });

  it("unpacks once into .unpacked, keeping exec bits, and leaves a directory without archives alone", async () => {
    const assets = path.join(dir, "assets");
    await fs.mkdir(path.join(assets, "archives"), { recursive: true });
    await fs.writeFile(
      path.join(assets, "archives", "one.tgz"),
      await packArchive(
        await source({ "plugins/package.json": "{}", "node_modules/p/spawn-helper": "#!" }),
      ),
    );
    const out = unpackedAssetsDir(assets);
    expect(out).toBe(path.join(assets, UNPACKED_DIR));
    expect(await fs.readFile(path.join(out, "plugins", "package.json"), "utf8")).toBe("{}");
    if (process.platform !== "win32") {
      expect(
        (await fs.stat(path.join(out, "node_modules", "p", "spawn-helper"))).mode & 0o111,
      ).not.toBe(0);
    }
    // Complete: the second call reads the marker and extracts nothing (a planted file survives).
    await fs.writeFile(path.join(out, "planted"), "x");
    expect(unpackedAssetsDir(assets)).toBe(out);
    expect(await fs.readFile(path.join(out, "planted"), "utf8")).toBe("x");
    // A crash mid-extraction (no marker) is redone from scratch.
    await fs.rm(path.join(out, ".complete"));
    unpackedAssetsDir(assets);
    await expect(fs.stat(path.join(out, "planted"))).rejects.toThrow();

    const plain = path.join(dir, "plain");
    await fs.mkdir(plain);
    expect(unpackedAssetsDir(plain)).toBe(plain);
  });
});
