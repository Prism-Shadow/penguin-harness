/**
 * The plugin prefixes (plugin/prefix.ts, install.ts, registry.ts): download, recovery, adoption,
 * where the build's prefix is, and which package or index row a name resolves to.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pickIndexEntry } from "../src/api/plugin-pick.js";
import type { PluginIndexEntry } from "../src/api/types.js";
import {
  adoptRetained,
  downloadPlugin,
  PluginInstallError,
  PluginIntegrityMismatch,
  recoverPrefix,
} from "../src/plugin/install.js";
import { buildPrefix, localPackage, pickLocal, pluginBases } from "../src/plugin/prefix.js";
import {
  builtinPluginRegistry,
  downloadedPluginRegistry,
  mergeIndexes,
} from "../src/plugin/registry.js";
import { integrityOf, packDir, useScratch, writeShippedIndex } from "./plugin-fixtures.js";

let dir: string;
let root: string;
useScratch("plugin-prefix-", (at) => ({ dir, root } = at));

/** `@acme/x` at `version` packed into `<dir>/<where>/x.tgz`: the file and its index row. */
async function packed(where: string, version = "1.0.0") {
  const src = path.join(dir, where, "src");
  await fs.mkdir(src, { recursive: true });
  await fs.writeFile(path.join(src, "package.json"), JSON.stringify({ name: "@acme/x", version }));
  await fs.writeFile(path.join(src, "README.md"), `# x ${version}`);
  const file = path.join(dir, where, "x.tgz");
  const integrity = await packDir(src, file);
  return { file, row: { name: "@acme/x", version, integrity } };
}

/** A registry fetch that hands over `file` as npm pack would, recording what it was asked. */
const serve =
  (file: string, asked: string[] = []) =>
  async (spec: string, cwd: string) => {
    asked.push(spec);
    await fs.copyFile(file, path.join(cwd, "acme-x.tgz"));
  };

const prefix = () => path.join(root, "plugins");
const target = () => path.join(prefix(), "node_modules", "@acme", "x");
const staging = async () => fs.readdir(path.join(prefix(), ".staging")).catch(() => []);

/** A package `@acme/x` at `version` unpacked under `<pre>/node_modules`, as a build ships it. */
async function shipIn(pre: string, version: string) {
  const pkg = path.join(pre, "node_modules", "@acme", "x");
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "@acme/x", version }));
  await writeShippedIndex(pre);
}

describe("a download", () => {
  it("unpacks the exact version, checked against the index row, and records its integrity", async () => {
    const { file, row } = await packed("a");
    const asked: string[] = [];
    await downloadPlugin(root, row, serve(file, asked));
    expect(asked).toEqual(["@acme/x@1.0.0"]);
    expect(localPackage(prefix(), "@acme/x")).toMatchObject(row);
    // Nothing is unpacked from a tarball that is not the row's, or from no tarball at all.
    const other = { ...row, version: "2.0.0", integrity: integrityOf("@acme/x", "2.0.0") };
    await expect(downloadPlugin(root, other, serve(file))).rejects.toBeInstanceOf(
      PluginIntegrityMismatch,
    );
    await expect(downloadPlugin(root, other, async () => {})).rejects.toBeInstanceOf(
      PluginInstallError,
    );
    expect(localPackage(prefix(), "@acme/x")?.version).toBe("1.0.0");
    // A newer version replaces it whole.
    const v2 = await packed("b", "2.0.0");
    await downloadPlugin(root, v2.row, serve(v2.file));
    expect(localPackage(prefix(), "@acme/x")).toMatchObject(v2.row);
    expect(await staging()).toEqual([]);
  });
});

describe("recovery", () => {
  it("puts back a package an interrupted replacement left aside, and clears the rest", async () => {
    const v1 = await packed("a");
    await downloadPlugin(root, v1.row, serve(v1.file));
    // Crashed between the two renames: the old package aside, nothing in its place.
    const aside = path.join(prefix(), ".staging", "d-crash");
    await fs.mkdir(aside, { recursive: true });
    await fs.rename(target(), path.join(aside, "package"));
    await fs.mkdir(path.join(prefix(), ".staging", "u-half", "package"), { recursive: true });
    await recoverPrefix(root);
    expect(localPackage(prefix(), "@acme/x")).toMatchObject(v1.row);
    expect(await staging()).toEqual([]);

    // Crashed after the second rename: the new one stays, the old one goes.
    await fs.mkdir(path.join(aside, "package"), { recursive: true });
    await fs.writeFile(path.join(aside, "package", "package.json"), '{"name":"@acme/x"}');
    await recoverPrefix(root);
    expect(localPackage(prefix(), "@acme/x")).toMatchObject(v1.row);
    expect(await staging()).toEqual([]);
  });
});

describe("a retained push", () => {
  it("hands over a plugin nothing else on the machine has, before its assets are pruned", async () => {
    const assets = path.join(root, "hmr", "store", "assets");
    await shipIn(path.join(assets, "old", "plugins"), "1.0.0");
    await shipIn(path.join(assets, "new", "plugins"), "0.5.0");
    const asks = new Map([
      ["@acme/x", [{ version: "^1" }]],
      ["../../x", [{}]],
    ]);
    // The build's 0.5.0 misses ^1, the retained 1.0.0 fits; "../../x" is no name, so no path.
    await adoptRetained(root, asks, path.join(assets, "new"));
    expect(localPackage(prefix(), "@acme/x")).toMatchObject({ version: "1.0.0" });

    // Once kept, the push can go: nothing is needed from it, or from the network.
    await fs.rm(path.join(assets, "old"), { recursive: true });
    await adoptRetained(root, asks, path.join(assets, "new"));
    expect(localPackage(prefix(), "@acme/x")?.version).toBe("1.0.0");
  });
});

describe("the build's prefix", () => {
  it("is the push's when it carries one, else beside the entry's target (the Docker link)", async () => {
    await shipIn(path.join(dir, "opt", "plugins"), "1.0.0");
    await fs.mkdir(path.join(dir, "opt", "dist"));
    await fs.writeFile(path.join(dir, "opt", "dist", "penguin.js"), "");
    const link = path.join(dir, "bin", "penguin");
    await fs.mkdir(path.dirname(link));
    await fs.symlink(path.join(dir, "opt", "dist", "penguin.js"), link);
    const opt = path.join(await fs.realpath(path.join(dir, "opt")), "plugins");
    expect(buildPrefix(null, link)).toBe(opt);
    const assets = path.join(dir, "assets");
    await shipIn(path.join(assets, "plugins"), "1.0.0");
    expect(buildPrefix(assets, link)).toBe(path.join(assets, "plugins"));
  });
});

describe("the index", () => {
  it("merges by content, the published first, leaving out yanked rows and naming a failing source", async () => {
    const assets = path.join(dir, "assets");
    await shipIn(path.join(assets, "plugins"), "1.0.0");
    const fetched = await packed("f", "2.0.0");
    await downloadPlugin(root, fetched.row, serve(fetched.file));
    const bases = () => pluginBases(root, assets);
    const source = (name: string, index: () => Promise<PluginIndexEntry[]>) => ({
      source: name,
      index,
      readme: async () => null,
    });
    const row = { name: "@acme/x", description: "", authors: [], license: "" };
    const { entries, failures } = await mergeIndexes([
      source("published", async () => [
        { ...row, version: "1.0.0", integrity: integrityOf("@acme/x", "1.0.0", "npm") },
        { ...row, version: "3.0.0", integrity: integrityOf("@acme/x", "3.0.0"), yanked: true },
      ]),
      builtinPluginRegistry(bases, () => assets),
      downloadedPluginRegistry(root, bases),
      source("dead", () => Promise.reject(new Error("down"))),
    ]);
    // npm's 1.0.0 and the build's own bytes under 1.0.0 are two contents, both listed.
    expect(entries.map((e) => e.version)).toEqual(["1.0.0", "1.0.0", "2.0.0"]);
    expect(failures).toEqual([{ source: "dead", error: "down" }]);
    expect(await downloadedPluginRegistry(root, bases).readme("@acme/x")).toBe("# x 2.0.0");
  });

  it("picks a pin, else the highest version the ask admits, never one without an integrity", () => {
    const row = (version: string, tag: string | null) => ({
      name: "@acme/x",
      version,
      description: "",
      authors: [],
      license: "",
      ...(tag === null ? {} : { integrity: integrityOf("@acme/x", version, tag) }),
    });
    const index = [row("1.0.0", "a"), row("2.0.0", "b"), row("3.0.0", null)];
    expect(pickIndexEntry(index, "@acme/x", {})).toBe(index[1]);
    expect(pickIndexEntry(index, "@acme/x", { integrity: index[0]!.integrity })).toBe(index[0]);
    expect(pickIndexEntry(index, "@acme/x", { version: "^3" })).toMatchObject({
      refused: expect.stringMatching(/without an integrity/),
    });
    expect(pickIndexEntry(index, "@acme/y", {})).toMatchObject({
      refused: expect.stringMatching(/not in/),
    });
  });

  it("loads a package without a recorded integrity by version, never by a pin", async () => {
    await fs.mkdir(target(), { recursive: true });
    await fs.writeFile(path.join(target(), "package.json"), '{"name":"@acme/x","version":"1.0.0"}');
    const bases = pluginBases(root, null);
    expect(pickLocal(bases, "@acme/x", [{ version: "^1" }])).toMatchObject({ version: "1.0.0" });
    const pin = integrityOf("@acme/x", "1.0.0");
    expect(pickLocal(bases, "@acme/x", [{ integrity: pin }])).toHaveProperty("refused");
  });
});
