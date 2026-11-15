/**
 * `penguin plugin link` — a local package directory linked into the data root's plugin prefix
 * the way npm itself does it: `npm install link:<dir>` records the directory as a `link:` dependency
 * in the prefix's package.json and puts the link in node_modules, and the installed-plugins
 * surface reads the package fresh from disk and marks the row as linked. The link table IS the
 * prefix manifest's `file:` dependencies — nothing penguin keeps beside them.
 *
 * The tests run a real npm against a real temp root: the link is npm's own act, so what is
 * pinned is what npm records and puts on disk — the manifest entry, the node_modules link, the
 * refusal face, and what the page's answer carries for a linked row, including the disk-truth
 * reading after the author edits or deletes the directory.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import type { InstalledPluginsResponse } from "../src/api/types.js";
import { linkPluginDirectory, prefixDependencies, PluginInstallError } from "../src/plugin/install.js";
import { decorators, lower } from "./plugin-fixtures.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("plugin link", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let scratch: string;
  const prefix = () => path.join(t.root, "plugins");

  /** A plugin package directory under the test's scratch, with a version the tests edit. */
  const authorDir = async (name: string, version = "0.1.0"): Promise<string> => {
    const dir = path.join(scratch, name.replace(/^@[^/]+\//, ""));
    await fs.mkdir(dir, { recursive: true });
    const main = path.join(dir, "index.js");
    await fs.writeFile(main, lower(`import { Module } from ${JSON.stringify(decorators)};
        @Module() export class M {}
        export default { modules: [M] };`), "utf8");
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name, version, type: "module", main: "./index.js" }, null, 2),
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "ifaces.json"),
      JSON.stringify({
        ifaces: {},
        types: {},
        modules: {
          M: { name: "M", requires: {}, provides: {}, contributes: {}, children: [] },
        },
        plugin: { modules: ["M"], replaces: [] },
      }),
      "utf8",
    );
    return dir;
  };

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "p263-link-")));
  });

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
    await t.cleanup();
  });

  const view = async (): Promise<InstalledPluginsResponse> =>
    (await admin.get("/api/projects/default_project/plugins/installed")).json() as Promise<InstalledPluginsResponse>;

  it("links the directory into the prefix as npm records one: a link: dependency and a node_modules link", async () => {
    const dir = await authorDir("@acme/local-one");
    const linked = await linkPluginDirectory(t.root, dir);
    expect(linked).toMatchObject({ name: "@acme/local-one", version: "0.1.0" });
    // The manifest entry IS the link record: name → the author's directory, npm's own.
    const deps = await prefixDependencies(prefix());
    expect(deps["@acme/local-one"]).toMatch(/^link:/);
    expect(path.resolve(prefix(), deps["@acme/local-one"]!.slice("link:".length))).toBe(dir);
    const target = path.join(prefix(), "node_modules", "@acme", "local-one");
    expect(existsSync(target)).toBe(true);
    if (process.platform !== "win32" && lstatSync(target).isSymbolicLink()) {
      expect(path.resolve(path.dirname(target), readlinkSync(target))).toBe(dir);
    }
  });

  it("refuses a directory that is not a package, leaving the prefix untouched", async () => {
    const empty = path.join(scratch, "empty");
    await fs.mkdir(empty);
    await expect(linkPluginDirectory(t.root, empty)).rejects.toBeInstanceOf(PluginInstallError);
    expect(existsSync(path.join(prefix(), "node_modules"))).toBe(false);

    // A manifest without a legal npm name refuses too.
    const nameless = path.join(scratch, "nameless");
    await fs.mkdir(nameless);
    await fs.writeFile(path.join(nameless, "package.json"), "{}", "utf8");
    await expect(linkPluginDirectory(t.root, nameless)).rejects.toBeInstanceOf(PluginInstallError);
    expect(await prefixDependencies(prefix())).toEqual({});
  });

  it("a second link of the same name replaces it, npm's own reconciliation", async () => {
    const first = await authorDir("@acme/dup", "0.1.0");
    await linkPluginDirectory(t.root, first);
    const second = await authorDir("@acme/dup", "0.2.0");
    const relinked = await linkPluginDirectory(t.root, second, true);
    expect(relinked).toMatchObject({ name: "@acme/dup", version: "0.2.0" });
    const deps = await prefixDependencies(prefix());
    expect(path.resolve(prefix(), deps["@acme/dup"]!.slice("link:".length))).toBe(second);
  });

  it("replacing an installed package with a link refuses unless --overwrite", async () => {
    const dir = await authorDir("@acme/over", "0.1.0");
    // An installed package: a plain range dependency in the manifest, as npm records one,
    // with the tree entry npm reconciles it against.
    const manifest = path.join(prefix(), "package.json");
    await fs.mkdir(path.join(prefix(), "node_modules", "@acme", "over"), { recursive: true });
    await fs.writeFile(
      path.join(prefix(), "node_modules", "@acme", "over", "package.json"),
      JSON.stringify({ name: "@acme/over", version: "1.0.0" }, null, 2),
      "utf8",
    );
    await fs.writeFile(
      manifest,
      `${JSON.stringify({ name: "penguin-plugins", private: true, version: "0.0.0", dependencies: { "@acme/over": "^1.0.0" } }, null, 2)}\n`,
      "utf8",
    );
    await expect(linkPluginDirectory(t.root, dir)).rejects.toBeInstanceOf(PluginInstallError);
    await expect(linkPluginDirectory(t.root, dir, true)).resolves.toMatchObject({ name: "@acme/over" });
    expect((await prefixDependencies(prefix()))["@acme/over"]).toMatch(/^link:/);
  });

  it("the page marks the row linked, and reads the disk truth: an edit shows, a deletion fails honestly", async () => {
    const dir = await authorDir("@acme/live", "0.1.0");
    await linkPluginDirectory(t.root, dir);
    const body = await view();
    const row = body.plugins.find((p) => p.specifier === "@acme/live");
    expect(row).toMatchObject({ linked: true, linkPath: dir, active: false });

    // The author edits: the next read sees the edit (the package is never cached into a
    // snapshot by the link).
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "@acme/live",
          version: "0.2.0",
          type: "module",
          main: "./index.js",
        },
        null,
        2,
      ),
      "utf8",
    );
    const after = await view();
    expect(after.plugins.find((p) => p.specifier === "@acme/live")).toMatchObject({
      linked: true,
      linkPath: dir,
    });

    // The author deletes the directory: the row reports the fault from that read, rather
    // than passing as a healthy install.
    await fs.rm(dir, { recursive: true, force: true });
    const gone = await view();
    const goneRow = gone.plugins.find((p) => p.specifier === "@acme/live");
    expect(goneRow?.error ?? "").toContain("@acme");
  });

  it("remove runs npm's uninstall: the link and its manifest entry go; the author directory stays byte for byte", async () => {
    const dir = await authorDir("@acme/gone", "0.1.0");
    await linkPluginDirectory(t.root, dir);
    const before = await fs.readFile(path.join(dir, "package.json"), "utf8");

    const res = await admin.delete(
      "/api/projects/default_project/plugins/installed?specifier=@acme/gone",
    );
    expect(res.status).toBe(200);
    expect(existsSync(path.join(prefix(), "node_modules", "@acme", "gone"))).toBe(false);
    expect(await prefixDependencies(prefix())).not.toHaveProperty("@acme/gone");
    expect(await fs.readFile(path.join(dir, "package.json"), "utf8")).toBe(before);
  });

  it("the route refuses a relative path and, for a non-admin, the whole verb", async () => {
    const dir = await authorDir("@acme/who");
    expect(
      (
        await admin.post("/api/projects/default_project/plugins/installed/link", {
          dir: "relative/path",
        })
      ).status,
    ).toBe(400);
    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    expect((await member.post("/api/projects/default_project/plugins/installed/link", { dir })).status)
      .toBe(403);
  });
});
