/**
 * The installed-plugins surface: what a PROJECT asks for, which of those the process is
 * actually running, and that writing the list is an admin operation which does not pretend to
 * load anything (plugins load once per process, in the runtime).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type { InstalledPluginsResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("installed plugins", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;

  const listFile = () => path.join(t.root, "default_project", ".project_config.toml");

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });

  afterEach(async () => {
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
    // A package that resolves (the root's own prefix) but throws on import.
    const prefix = path.join(t.root, "plugins");
    const dir = path.join(prefix, "node_modules", "@acme", "broken");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(prefix, "package.json"), '{"name":"prefix","private":true}');
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "@acme/broken",
        main: "./index.js",
        type: "module",
        penguin: {
          modules: [{ name: "Broken", requires: {}, provides: {}, contributes: {}, children: [] }],
        },
      }),
    );
    await fs.writeFile(path.join(dir, "index.js"), 'throw new Error("deliberately broken");\n');
    const saved = await admin.put("/api/projects/default_project/plugins/installed", {
      plugins: ["@acme/broken"],
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as InstalledPluginsResponse;
    expect(body.plugins[0]).toMatchObject({ specifier: "@acme/broken", active: false });
    expect(body.plugins[0]!.error).toMatch(/deliberately broken/);
    expect(body.restartPending).toBe(false);
  });

  it("reports a list file that cannot be read, rather than an empty deployment", async () => {
    await fs.writeFile(listFile(), "{ not json");
    const res = await admin.get("/api/projects/default_project/plugins/installed");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(".project_config.toml");
  });
});
