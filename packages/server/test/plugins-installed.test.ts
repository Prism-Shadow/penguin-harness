/**
 * The installed-plugins surface: what a PROJECT asks for, which of those the process is
 * actually running, and that writing the list is an admin operation which does not pretend to
 * load anything (plugins load once per process, in the runtime).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type { InstalledPluginsResponse } from "../src/api/types.js";
import { decorators, lower, writeClassPackage } from "./plugin-fixtures.js";
import type { ClassPackage } from "./plugin-fixtures.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("installed plugins", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  const programEntry = process.argv[1];

  const listFile = () => path.join(t.root, "default_project", ".project_config.toml");

  /**
   * Ships a package the way the build does: under the installation's `plugins/` prefix,
   * named in that prefix's manifest. The installation is what `process.argv[1]` points
   * into (plugin/loader.ts pluginBases), so the test app's program entry is pointed at a
   * directory of the temp root for the file's duration.
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
  };

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });

  afterEach(async () => {
    if (programEntry !== undefined) process.argv[1] = programEntry;
    await t.cleanup();
  });

  const view = async () =>
    (await (
      await admin.get("/api/projects/default_project/plugins/installed")
    ).json()) as InstalledPluginsResponse;

  it("reports an empty list when nothing is installed", async () => {
    const res = await view();
    expect(res.plugins).toEqual([]);
    expect(res.file).toBe(".project_config.toml");
    expect(res.restartPending).toBe(false);
  });

  it("a plugin the build ships is offered, not installed", async () => {
    // The shipped set is a tag for the catalogue: nothing appears as installed, and nothing
    // loads, until a Project names it. (A test app ships none, so the set is empty; the
    // load-time half of this is plugin-loader.test.ts.)
    const res = await view();
    expect(res.shipped).toEqual([]);
    expect(res.plugins).toEqual([]);
  });

  it("says a listed plugin is not active, and why when it cannot even be read", async () => {
    await fs.writeFile(listFile(), 'models = []\n[plugins]\n"@acme/not-installed" = "*"\n');
    const res = await view();
    expect(res.plugins).toHaveLength(1);
    expect(res.plugins[0]).toMatchObject({ specifier: "@acme/not-installed", active: false });
    // A specifier with no package on the machine is a configuration error, not a pending restart.
    expect(res.plugins[0]!.error).toMatch(/not installed on this machine/);
    expect(res.restartPending).toBe(false);
  });

  it("rewrites the list for an admin, and refuses everyone else", async () => {
    await ship({ name: "@acme/one", module: "One" });
    const saved = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/one", "@acme/one"],
    });
    expect(saved.status).toBe(200);
    // Written once: the table is keyed by name, in the order given — and it lands in the
    // Project's own config, beside its models, rather than in a file of its own.
    expect(
      ((await saved.json()) as InstalledPluginsResponse).plugins.map((p) => p.specifier),
    ).toEqual(["@acme/one"]);
    const written = await fs.readFile(listFile(), "utf8");
    expect(written).toContain("[plugins]");
    expect(written).toContain('"@acme/one" = "*"');

    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    // The list is the PROJECT's now, so it is reachable only by that Project's people. An
    // outsider is refused before the admin check ever runs.
    expect((await member.get("/api/projects/default_project/plugins/installed")).status).toBe(404);
    expect(
      (await admin.post("/api/projects/default_project/members", { userId: "member" })).status,
    ).toBe(201);
    // Reading is not an admin operation: a member of the Project sees what it asked for.
    expect((await member.get("/api/projects/default_project/plugins/installed")).status).toBe(200);
    // Writing still is.
    expect(
      (await member.put("/api/projects/default_project/plugins/installed", { plugins: [] })).status,
    ).toBe(403);
    expect(
      (await admin.put("/api/projects/default_project/plugins/installed", { plugins: [""] }))
        .status,
    ).toBe(400);
  });

  it("a rewrite is gated like an add: a new name must be a shipped package's", async () => {
    // What a single add refuses, a list rewrite refuses too — otherwise PUT would be the
    // way to name a path or an unshipped package. A name already on the list was consented
    // to when it was written and stays writable, so removing another name beside it works.
    await fs.writeFile(listFile(), 'models = []\n[plugins]\n"@acme/by-hand" = "*"\n');
    for (const bad of ["/tmp/anything.js", "../x", "@acme/tools/sandbox", "pkg@1.0.0"]) {
      const res = await admin.put("/api/projects/default_project/plugins/installed", {
        plugins: ["@acme/by-hand", bad],
      });
      expect(res.status, bad).toBe(400);
      expect(await res.json(), bad).toMatchObject({ error: { code: "bad_request" } });
    }
    const unshipped = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/by-hand", "@acme/not-shipped"],
    });
    expect(unshipped.status).toBe(400);
    expect(await unshipped.json()).toMatchObject({ error: { code: "plugin_not_shipped" } });
    expect(await fs.readFile(listFile(), "utf8")).toContain('"@acme/by-hand" = "*"');
    expect(await fs.readFile(listFile(), "utf8")).not.toContain("not-shipped");
    const kept = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/by-hand"],
    });
    expect(kept.status).toBe(200);
  });

  it("refuses a specifier that is not a package name, or one the build does not ship", async () => {
    for (const bad of ["../evil", "https://example.com/x.tgz", "", "Has Spaces", "pkg@1.0.0"]) {
      expect(
        (await admin.post("/api/projects/default_project/plugins/installed", { specifier: bad }))
          .status,
        bad,
      ).toBe(400);
    }
    // A well-formed name the build does not ship is fetched from nowhere: refused, and the
    // list is left as it was rather than naming a package that is not on the machine.
    const res = await admin.post("/api/projects/default_project/plugins/installed", {
      specifier: "@acme/not-shipped",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "plugin_not_shipped" } });
    expect(await view()).toMatchObject({ plugins: [] });
  });

  it("drops a specifier from the list on delete", async () => {
    await ship({ name: "@acme/one", module: "One" });
    await ship({ name: "@acme/two", module: "Two" });
    await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/one", "@acme/two"],
    });
    const res = await admin.delete(
      "/api/projects/default_project/plugins/installed?specifier=@acme/one",
    );
    expect(res.status).toBe(200);
    expect((await view()).plugins.map((p) => p.specifier)).toEqual(["@acme/two"]);
    const member = apiClient(t.app, (await provisionUser(t.app, "other")).cookie);
    expect(
      (await member.delete("/api/projects/default_project/plugins/installed?specifier=@acme/two"))
        .status,
    ).toBe(403);
  });

  it("reports why a listed plugin failed to load, not a restart that would not help", async () => {
    // A shipped package that throws on import.
    await ship({
      name: "@acme/broken",
      module: "Broken",
      index: 'throw new Error("deliberately broken");\n',
    });
    const saved = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/broken"],
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as InstalledPluginsResponse;
    expect(body.plugins[0]).toMatchObject({ specifier: "@acme/broken", active: false });
    expect(body.plugins[0]!.error).toMatch(/deliberately broken/);
    expect(body.restartPending).toBe(false);
  });

  it("a plugin that breaks the boot is undone, and the previous App keeps serving", async () => {
    // A load failure is isolated per entry; a BOOT failure (the module's setup throws) is
    // not — the kernel fails the whole tree. The change that introduced it is undone before
    // the previous tree is restored, so the process is not left forwarding to a disposed
    // App, and the next start does not fail on the same list.
    await ship({ name: "@acme/fine", module: "Fine" });
    await ship({
      name: "@acme/bad-boot",
      module: "BadBoot",
      index: lower(`import { Module } from ${JSON.stringify(decorators)};
        @Module() export class BadBoot { setup() { throw new Error("deliberately fails to boot"); } }
        export default { modules: [BadBoot] };`),
    });
    expect(
      (
        await admin.post("/api/projects/default_project/plugins/installed", {
          specifier: "@acme/fine",
        })
      ).status,
    ).toBe(200);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await admin.post("/api/projects/default_project/plugins/installed", {
        specifier: "@acme/bad-boot",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as InstalledPluginsResponse;
      // Undone: the list is as it was, and what runs is what ran.
      expect(body.plugins.map((p) => [p.specifier, p.active])).toEqual([["@acme/fine", true]]);
      expect(await fs.readFile(listFile(), "utf8")).not.toContain("bad-boot");
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/deliberately fails to boot/));
    } finally {
      warn.mockRestore();
    }
    // Still serving, on the restored App.
    expect((await admin.get("/api/projects/default_project/plugins/installed")).status).toBe(200);
  });

  it("reports a list file that cannot be read, rather than an empty deployment", async () => {
    await fs.writeFile(listFile(), "{ not json");
    const res = await admin.get("/api/projects/default_project/plugins/installed");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(".project_config.toml");
  });
});
