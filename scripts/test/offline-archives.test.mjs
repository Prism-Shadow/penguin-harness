/**
 * The build's offline archives (scripts/lib/offline-archives.mjs):
 * - Given plugins the market lists, one the build ships and one it does not, and a plugin it does
 *   not list, only the listed one the build does not ship is carried.
 * - Given that plugin built, its tarball lands under `offline/` with the sha512 of its bytes, its
 *   own package.json and ifaces.json beside it, and the index names all three.
 * - Given a candidate whose build left no ifaces.json, staging refuses it, naming the package.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { offlineCandidates, stageOfflineArchives } from "../lib/offline-archives.mjs";

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "offline-archives-"));
  const plugin = async (dir, name, files = {}) => {
    await fs.mkdir(path.join(root, "plugins", dir), { recursive: true });
    await fs.writeFile(
      path.join(root, "plugins", dir, "package.json"),
      JSON.stringify({ name, version: "1.2.3" }),
    );
    for (const [rel, text] of Object.entries(files)) {
      await fs.writeFile(path.join(root, "plugins", dir, rel), text);
    }
  };
  await plugin("computer-use", "@acme/computer-use", { "ifaces.json": '{"ifaces":{}}' });
  await plugin("sandbox", "@acme/sandbox");
  await plugin("notes", "@acme/notes");
  const indexFile = path.join(root, "index.json");
  await fs.writeFile(
    indexFile,
    JSON.stringify([{ name: "@acme/computer-use" }, { name: "@acme/sandbox" }]),
  );
  return { root, indexFile, pluginsSrc: path.join(root, "plugins") };
}

it("carries the listed plugins the build does not ship, and nothing else", async () => {
  const { root, indexFile, pluginsSrc } = await workspace();
  try {
    const found = await offlineCandidates({
      pluginsSrc,
      indexFile,
      shipped: new Set(["@acme/sandbox"]),
    });
    assert.deepEqual(
      found.map((c) => [c.name, c.version, path.basename(c.dir)]),
      [["@acme/computer-use", "1.2.3", "computer-use"]],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("stages each one's tarball with its sha512, its manifest and its table", async () => {
  const { root, indexFile, pluginsSrc } = await workspace();
  const out = path.join(root, "prefix");
  try {
    const candidates = await offlineCandidates({ pluginsSrc, indexFile, shipped: new Set() });
    const built = [];
    const bytes = Buffer.from("what pnpm pack wrote");
    const rows = await stageOfflineArchives({
      out,
      candidates: candidates.filter((c) => c.name === "@acme/computer-use"),
      build: (c) => built.push(c.name),
      pack: async (_dir, into) => {
        const file = path.join(into, "acme-computer-use-1.2.3.tgz");
        await fs.writeFile(file, bytes);
        return file;
      },
    });
    assert.deepEqual(built, ["@acme/computer-use"]);
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    const expected = [
      {
        name: "@acme/computer-use",
        version: "1.2.3",
        file: "acme-computer-use-1.2.3.tgz",
        integrity,
        meta: "computer-use",
      },
    ];
    assert.deepEqual(rows, expected);
    const offline = path.join(out, "offline");
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(offline, "index.json"), "utf8")),
      expected,
    );
    assert.equal(
      await fs.readFile(path.join(offline, "computer-use", "ifaces.json"), "utf8"),
      '{"ifaces":{}}',
    );
    assert.match(
      await fs.readFile(path.join(offline, "computer-use", "package.json"), "utf8"),
      /1\.2\.3/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("refuses a candidate whose build left no ifaces.json", async () => {
  const { root, indexFile, pluginsSrc } = await workspace();
  try {
    const candidates = await offlineCandidates({ pluginsSrc, indexFile, shipped: new Set() });
    await assert.rejects(
      stageOfflineArchives({
        out: path.join(root, "prefix"),
        candidates: candidates.filter((c) => c.name === "@acme/sandbox"),
        build: () => {},
        pack: async () => assert.fail("never packed"),
      }),
      /@acme\/sandbox has no ifaces\.json/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
