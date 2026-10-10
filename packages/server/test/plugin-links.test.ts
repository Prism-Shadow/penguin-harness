/**
 * Local plugin links (plugin/links.ts, the /local routes): enabling a local plugin links
 * its directory into the host's plugin prefix and lists its package for a Project in one
 * step, recording who linked it, when, from where — and one step undoes both.
 *
 * - The name is the one the directory's own package.json gives itself; the Project's table
 *   stays names-only, and what loads still loads by name.
 * - The link is an input to activation: the generation's `node_modules/<name>` points at
 *   the directory, the record is what makes that survive re-assembly and restarts, and a
 *   directory that stops being a loadable plugin package is reported on its row with why.
 * - What cannot be linked is refused with its reason — a relative path, a directory that
 *   does not exist, one without a package, one that was never built — and nothing is
 *   written: no name is listed that could not load.
 * - A locally enabled plugin's declared skills ride the link: the row offers them, and the
 *   install route writes them onto an Agent by package name (plugin/skills.ts's slot).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { skillsDir } from "@prismshadow/penguin-core";
import type { AgentPluginsInstallResponse, InstalledPluginsResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { decorators, lower, writeClassPackage, writeShippedIndex } from "./plugin-fixtures.js";
import type { ClassPackage } from "./plugin-fixtures.js";

/** A SKILL.md whose directory is its name, the library's rule. */
const TUNE = `---
name: send-tune
description: Makes a tune.
---

# Send a tune
`;

describe("local plugin links", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let adminId: string;
  const programEntry = process.argv[1];

  const listFile = () => path.join(t.root, "default_project", ".project_config.toml");
  const linksFile = () => path.join(t.root, "plugin-links.json");
  const localDir = (name: string) => path.join(t.root, "local", ...name.split("/"));
  const currentGen = async () =>
    (await fs.readFile(path.join(t.root, "plugins", "current"), "utf8")).trim();

  /**
   * Ships a package the way the build does: under the installation's `plugins/` prefix,
   * named in that prefix's manifest — a source of the plugin store. The installation is
   * what `process.argv[1]` points into (plugin/store.ts storeSources), so the test app's
   * program entry is pointed at a directory of the temp root for the file's duration.
   */
  const ship = async (pkg: ClassPackage) => {
    const prefix = path.join(t.root, "install", "plugins");
    process.argv[1] = path.join(t.root, "install", "bin", "server.js");
    const manifestFile = path.join(prefix, "package.json");
    const manifest = JSON.parse(
      await fs.readFile(manifestFile, "utf8").catch(() => '{"name":"prefix","private":true}'),
    ) as { dependencies?: Record<string, string> };
    manifest.dependencies = { ...manifest.dependencies, [pkg.name]: "0.0.0" };
    await fs.mkdir(prefix, { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    await writeClassPackage(path.join(prefix, "node_modules", ...pkg.name.split("/")), pkg);
    await writeShippedIndex(prefix);
  };

  const view = async () =>
    (await (
      await admin.get("/api/projects/default_project/plugins/installed")
    ).json()) as InstalledPluginsResponse;

  beforeEach(async () => {
    t = await createTestApp();
    const adminUser = await loginAdmin(t.app);
    admin = apiClient(t.app, adminUser.cookie);
    adminId = adminUser.user.userId;
  });

  afterEach(async () => {
    if (programEntry !== undefined) process.argv[1] = programEntry;
    await t.cleanup();
  });

  it("enables a local plugin in one step: linked, listed, recorded — the table names only", async () => {
    const dir = localDir("@acme/player");
    await writeClassPackage(dir, { name: "@acme/player", module: "Player" });
    const res = await admin.post("/api/projects/default_project/plugins/installed/local", {
      path: dir,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as InstalledPluginsResponse;
    // Running, and enabled for the Project — with its provenance on the row.
    expect(body.plugins[0]).toMatchObject({
      specifier: "@acme/player",
      active: true,
      everywhere: true,
      here: true,
    });
    expect(body.plugins[0]!.local).toMatchObject({ path: dir, by: adminId });
    expect(body.plugins[0]!.local!.linkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // The table lists the package name alone; a path never enters it.
    const written = await fs.readFile(listFile(), "utf8");
    expect(written).toContain('"@acme/player"');
    expect(written).not.toContain(dir);
    // The record holds the provenance the row shows.
    const record = JSON.parse(await fs.readFile(linksFile(), "utf8")) as Record<string, unknown>;
    expect(record["@acme/player"]).toMatchObject({ path: dir, by: adminId });
    // The generation links the directory itself: the name resolves to what it holds.
    const gen = await currentGen();
    expect(
      await realpath(path.join(t.root, "plugins", gen, "node_modules", "@acme", "player")),
    ).toBe(await realpath(dir));
  });

  it("a link outlives a table edit: a rewrite re-lists a linked name, and a re-assembly keeps the link", async () => {
    const dir = localDir("@acme/player");
    await writeClassPackage(dir, { name: "@acme/player", module: "Player" });
    expect(
      (
        await admin.post("/api/projects/default_project/plugins/installed/local", { path: dir })
      ).status,
    ).toBe(200);
    // A table-only removal (the plain verb): the name leaves the list, the record stays —
    // the link is the machine's, not the list's.
    expect(
      (
        await admin.delete(
          "/api/projects/default_project/plugins/installed?specifier=@acme/player",
        )
      ).status,
    ).toBe(200);
    expect((await view()).plugins).toEqual([]);
    expect(JSON.parse(await fs.readFile(linksFile(), "utf8"))["@acme/player"]).toBeDefined();
    // A rewrite that adds the linked name back is admitted — the name is on the machine
    // through its link — and the re-assembly answers from the record again.
    const put = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/player"],
    });
    expect(put.status).toBe(200);
    // A later re-assembly around other plugins keeps the linked one running, and the
    // record carries it through unchanged.
    await ship({ name: "@acme/store-one", module: "StoreOne" });
    const both = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/player", "@acme/store-one"],
    });
    expect(both.status).toBe(200);
    const rows = ((await both.json()) as InstalledPluginsResponse).plugins;
    expect(rows.find((p) => p.specifier === "@acme/player")).toMatchObject({
      active: true,
      local: { path: dir },
    });
    expect(rows.find((p) => p.specifier === "@acme/store-one")).toMatchObject({ active: true });
    expect(JSON.parse(await fs.readFile(linksFile(), "utf8"))["@acme/player"]).toMatchObject({
      path: dir,
    });
  });

  it("undoes a local link in one step: unlisted, unlinked, and nothing answers the name after", async () => {
    const dir = localDir("@acme/player");
    await writeClassPackage(dir, { name: "@acme/player", module: "Player" });
    expect(
      (
        await admin.post("/api/projects/default_project/plugins/installed/local", { path: dir })
      ).status,
    ).toBe(200);
    // A member cannot undo an admin's link; the admin's one step does.
    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    expect(
      (
        await member.delete("/api/projects/default_project/plugins/installed/local?specifier=@acme/player")
      ).status,
    ).toBe(403);
    const undone = await admin.delete(
      "/api/projects/default_project/plugins/installed/local?specifier=@acme/player",
    );
    expect(undone.status).toBe(200);
    const body = (await undone.json()) as InstalledPluginsResponse;
    expect(body.plugins).toEqual([]);
    expect(await fs.readFile(listFile(), "utf8")).not.toContain("@acme/player");
    // The record went with it: nothing is left that would make the name resolve to the
    // directory again.
    expect(JSON.parse(await fs.readFile(linksFile(), "utf8"))["@acme/player"]).toBeUndefined();
    expect(
      await fs
        .access(path.join(t.root, "plugins", await currentGen(), "node_modules", "@acme", "player"))
        .then(
          () => true,
          () => false,
        ),
    ).toBe(false);
    // A name that is not linked is a 404, not a quiet table edit.
    expect(
      (
        await admin.delete(
          "/api/projects/default_project/plugins/installed/local?specifier=@acme/player",
        )
      ).status,
    ).toBe(404);
  });

  it("refuses what it cannot link, each with its reason, and writes nothing", async () => {
    const plain = localDir("plain");
    await fs.mkdir(plain, { recursive: true });
    const unbuilt = localDir("unbuilt");
    await fs.mkdir(unbuilt, { recursive: true });
    await fs.writeFile(
      path.join(unbuilt, "package.json"),
      JSON.stringify({ name: "@acme/unbuilt", version: "0.0.0", main: "./dist/index.js" }),
    );
    const cases: Array<[string, RegExp]> = [
      ["relative/path", /not an absolute path/],
      [localDir("gone"), /does not exist/],
      [plain, /no readable package\.json with a package name and a version/],
      [unbuilt, /the package's entry file does not exist: .*build the package first/],
    ];
    for (const [bad, why] of cases) {
      const res = await admin.post("/api/projects/default_project/plugins/installed/local", {
        path: bad,
      });
      expect(res.status, bad).toBe(400);
      const error = (await res.json()) as { error: { code: string; message: string } };
      expect(error, bad).toMatchObject({ error: { code: "invalid_local_plugin" } });
      expect(error.error.message, bad).toMatch(why);
    }
    expect((await view()).plugins).toEqual([]);
    // Nothing was written: no table, no record.
    expect(await fs.readFile(listFile(), "utf8")).not.toContain("@acme");
    expect(
      await fs
        .access(linksFile())
        .then(
          () => true,
          () => false,
        ),
    ).toBe(false);
    // A non-admin gets none of it.
    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    expect(
      (
        await member.post("/api/projects/default_project/plugins/installed/local", {
          path: localDir("plain"),
        })
      ).status,
    ).toBe(403);
  });

  it("reports a linked name whose directory stopped being a plugin package, and the rest still runs", async () => {
    const dir = localDir("@acme/player");
    await writeClassPackage(dir, { name: "@acme/player", module: "Player" });
    expect(
      (
        await admin.post("/api/projects/default_project/plugins/installed/local", { path: dir })
      ).status,
    ).toBe(200);
    await ship({ name: "@acme/store-one", module: "StoreOne" });
    await ship({ name: "@acme/store-two", module: "StoreTwo" });
    // The directory's entry goes away — rebuilt out, moved, removed — and a later
    // re-assembly reads the link again.
    await fs.rm(path.join(dir, "index.js"));
    const res = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/player", "@acme/store-one", "@acme/store-two"],
    });
    expect(res.status).toBe(200);
    const rows = ((await res.json()) as InstalledPluginsResponse).plugins;
    const row = rows.find((p) => p.specifier === "@acme/player")!;
    expect(row.active).toBe(false);
    expect(row.error).toMatch(/no longer a loadable plugin package.*build the package first/s);
    // The provenance is a fact about the name, not about the load: still on the row.
    expect(row.local).toMatchObject({ path: dir, by: adminId });
    // The rest of the generation was placed as usual.
    expect(rows.find((p) => p.specifier === "@acme/store-one")).toMatchObject({ active: true });
    expect(rows.find((p) => p.specifier === "@acme/store-two")).toMatchObject({ active: true });
  });

  it("a local plugin's declared skills ride the link, and install onto an Agent by package name", async () => {
    // A built package in a directory of its own, declaring a skill on the slot — the way
    // the example plugins do — enabled through the link route.
    const dir = localDir("@acme/tunes");
    await fs.mkdir(path.join(dir, "skills", "send-tune"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "@acme/tunes",
        version: "1.0.0",
        type: "module",
        main: "./index.js",
      }),
    );
    const declares = {
      "PluginSkillsProvider.skills": [{ id: "acme.send-tune", path: "skills/send-tune" }],
    };
    await fs.writeFile(
      path.join(dir, "ifaces.json"),
      JSON.stringify({
        ifaces: {},
        types: {},
        modules: {
          AcmeTunes: {
            name: "AcmeTunes",
            requires: {},
            provides: {},
            contributes: declares,
            children: [],
          },
        },
        plugin: { modules: ["AcmeTunes"], replaces: [] },
      }),
    );
    await fs.writeFile(
      path.join(dir, "index.js"),
      lower(`
        import { Component } from ${JSON.stringify(decorators)};
        @Component({ contributes: ${JSON.stringify(declares)} })
        export class AcmeTunes {}
        export default { modules: [AcmeTunes] };
      `),
    );
    await fs.writeFile(path.join(dir, "skills", "send-tune", "SKILL.md"), TUNE);
    expect(
      (
        await admin.post("/api/projects/default_project/plugins/installed/local", { path: dir })
      ).status,
    ).toBe(200);
    const row = (await view()).plugins[0]!;
    expect(row).toMatchObject({ specifier: "@acme/tunes", active: true });
    expect(row.skills).toEqual([{ name: "send-tune", description: "Makes a tune.", version: "" }]);
    // The skill installs onto an Agent by the package name, through the same route and
    // writer a library skill takes.
    const res = await admin.post("/api/projects/default_project/agents/default_agent/plugins", {
      names: ["@acme/tunes"],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AgentPluginsInstallResponse;
    expect(body.skills.find((s) => s.name === "send-tune")).toMatchObject({
      description: "Makes a tune.",
    });
    expect(
      await fs.readFile(
        path.join(skillsDir(t.root, "default_project", "default_agent"), "send-tune", "SKILL.md"),
        "utf8",
      ),
    ).toBe(TUNE);
  });
});
