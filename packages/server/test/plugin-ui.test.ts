/**
 * GET /api/plugins/<package>/ui/* (http/routes/plugin-ui.ts) on a real App: a plugin's shipped
 * page is served once the plugin is loaded, and nothing else is.
 *
 * - Before a Project asks for the package, its files answer 404; once it is installed (and the
 *   App re-assembled), its `ui/` files are served with their content types, for a scoped and an
 *   unscoped package name alike.
 * - Nothing outside the package's `ui/` is reachable: an encoded `..`, a symlink pointing out of
 *   `ui/`, a directory, a file beside `ui/`. A package name that is not loaded is 404.
 * - The route requires a signed-in user, like its neighbours.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { writeClassPackage } from "./plugin-fixtures.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("plugin ui route", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  const programEntry = process.argv[1];

  /**
   * Ships a package the way the build does (plugins-installed.test.ts says why the program
   * entry moves) and gives it a `ui/` beside its entry; returns the package directory.
   */
  const ship = async (name: string, module: string): Promise<string> => {
    const prefix = path.join(t.root, "install", "plugins");
    process.argv[1] = path.join(t.root, "install", "bin", "server.js");
    const manifestFile = path.join(prefix, "package.json");
    const manifest = JSON.parse(
      await fs.readFile(manifestFile, "utf8").catch(() => '{"name":"prefix","private":true}'),
    ) as { dependencies?: Record<string, string> };
    manifest.dependencies = { ...manifest.dependencies, [name]: "0.0.0" };
    await fs.mkdir(prefix, { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    const dir = path.join(prefix, "node_modules", ...name.split("/"));
    await writeClassPackage(dir, { name, module });
    await fs.mkdir(path.join(dir, "ui", "sub"), { recursive: true });
    await fs.writeFile(path.join(dir, "ui", "index.html"), "<h1>hello</h1>");
    await fs.writeFile(path.join(dir, "ui", "app.js"), "export {};");
    await fs.writeFile(path.join(dir, "secret.txt"), "not for the frame");
    await fs.symlink(path.join(dir, "secret.txt"), path.join(dir, "ui", "leak.txt"));
    return dir;
  };

  const install = async (specifier: string) => {
    const res = await admin.post("/api/projects/default_project/plugins/installed", {
      specifier,
    });
    expect(res.status).toBe(200);
  };

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });

  afterEach(async () => {
    if (programEntry !== undefined) process.argv[1] = programEntry;
    await t.cleanup();
  });

  const UI = "/api/plugins/@acme/pages/ui";

  it("serves a loaded plugin's ui/ files, and nothing before it is installed", async () => {
    await ship("@acme/pages", "Pages");
    expect((await admin.get(`${UI}/index.html`)).status).toBe(404);

    await install("@acme/pages");
    const html = await admin.get(`${UI}/index.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(html.headers.get("cache-control")).toBe("no-cache");
    expect(await html.text()).toBe("<h1>hello</h1>");
    const js = await admin.get(`${UI}/app.js`);
    expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  it("serves an unscoped package name too", async () => {
    await ship("plain-pages", "PlainPages");
    await install("plain-pages");
    expect((await admin.get("/api/plugins/plain-pages/ui/index.html")).status).toBe(200);
  });

  it("reaches nothing outside the package's ui/, and no package that is not loaded", async () => {
    await ship("@acme/pages", "Pages");
    await ship("@acme/idle", "Idle");
    await install("@acme/pages");
    for (const rel of [
      "..%2Fsecret.txt",
      "%2E%2E%2Fsecret.txt",
      "leak.txt",
      "sub",
      "",
      "nope.js",
    ]) {
      expect((await admin.get(`${UI}/${rel}`)).status, rel).toBe(404);
    }
    expect((await admin.get("/api/plugins/@acme/pages/secret.txt")).status).toBe(404);
    expect((await admin.get("/api/plugins/@acme/idle/ui/index.html")).status).toBe(404);
  });

  it("requires a signed-in user", async () => {
    await ship("@acme/pages", "Pages");
    await install("@acme/pages");
    expect((await t.app.request(`${UI}/index.html`)).status).toBe(401);
  });
});
