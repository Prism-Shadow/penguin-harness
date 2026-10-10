/**
 * Pushed assets travel as archives: the deploy packs each package into one deterministic
 * `.tgz`, and the platform unpacks `archives/` once into `.unpacked/` before resolving from it.
 *
 * - The same files give the same bytes whatever their order, their mtimes on disk and the
 *   clock at packing time, so an unchanged package is an unchanged blob; a scoped package's
 *   archive is named flat.
 * - Unpacking happens once (a marker records completion), keeps exec bits, is redone from
 *   scratch after a crash mid-extraction, and leaves a directory without archives alone.
 * - A store copied off a Mac with its `tar` carries an AppleDouble `._<name>` beside each
 *   archive; those are not archives, and the real ones still unpack.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    // An hour later, on disk and on the clock: neither may show in the bytes.
    const later = new Date(Date.now() + 3_600_000);
    for (const entry of entries) await fs.utimes(entry.abs, later, later);
    vi.useFakeTimers({ toFake: ["Date"], now: later });
    try {
      const second = (await packArchive([...entries].reverse())) as Buffer;
      expect(first.equals(second)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  it("unpacks the real archives of a store that came off a Mac with AppleDouble companions", async () => {
    const assets = path.join(dir, "assets");
    await fs.mkdir(path.join(assets, "archives"), { recursive: true });
    await fs.writeFile(
      path.join(assets, "archives", "node-pty.tgz"),
      await packArchive(await source({ "node_modules/node-pty/package.json": "{}" })),
    );
    // What macOS's bsdtar writes for a file carrying com.apple.provenance: attribute bytes.
    await fs.writeFile(
      path.join(assets, "archives", "._node-pty.tgz"),
      Buffer.from([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]),
    );
    const out = unpackedAssetsDir(assets);
    expect(
      await fs.readFile(path.join(out, "node_modules", "node-pty", "package.json"), "utf8"),
    ).toBe("{}");
  });
});
