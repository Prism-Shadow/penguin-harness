/**
 * Serving a package's page files (PRFC-0036): what a server module's own route hands out of its
 * `ui/` folder, through the face's contained static-files helper, over a real folder and a route.
 *
 * - A file under the folder is served with its content type and revalidated on every load.
 * - A path that climbs out (`..`), an absolute or backslashed one, a missing file and a folder
 *   are not served.
 * - Nothing is reached through a link: neither one pointing out of the folder nor one inside it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { containedFile, uiFileResponse } from "../src/plugin/index.js";
import { makeTempRoot, removeTempRoot } from "./helpers.js";

describe("a package's page files", () => {
  let root: string;
  let ui: string;
  let app: Hono;

  beforeAll(async () => {
    root = await makeTempRoot();
    ui = path.join(root, "pkg", "ui");
    await fs.mkdir(path.join(ui, "assets"), { recursive: true });
    await fs.writeFile(path.join(ui, "index.html"), "<!doctype html><title>App</title>");
    await fs.writeFile(path.join(ui, "assets", "app.js"), "export {};");
    await fs.mkdir(path.join(root, "outside"));
    await fs.writeFile(path.join(root, "outside", "secret.txt"), "secret");
    await fs.symlink(path.join(root, "outside"), path.join(ui, "out"), "dir");
    await fs.symlink(path.join(ui, "assets"), path.join(ui, "again"), "dir");
    // The route a plugin writes over the helper: its wildcard is the path under `ui/`.
    app = new Hono();
    app.get("/ui/*", async (c) => {
      const rel = decodeURIComponent(c.req.path.slice("/ui/".length));
      const file = await containedFile(ui, rel);
      return file === null ? c.text("not found", 404) : uiFileResponse(c, file);
    });
  });
  afterAll(async () => {
    await removeTempRoot(root);
  });

  it("serves a file under the folder with its type, revalidated on every load", async () => {
    const page = await app.request("/ui/index.html");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(await page.text()).toContain("<title>App</title>");
    const script = await app.request("/ui/assets/app.js");
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  it("serves nothing outside the folder, missing, or a folder", async () => {
    const refused = [
      "../outside/secret.txt",
      "assets/../../outside/secret.txt",
      "/etc/hosts",
      "assets\\app.js",
      "nope.html",
      "assets",
      "",
    ];
    for (const rel of refused) expect(await containedFile(ui, rel), rel).toBeNull();
    expect((await app.request("/ui/%2E%2E/outside/secret.txt")).status).toBe(404);
  });

  it("reaches nothing through a link, out of the folder or inside it", async () => {
    expect(await containedFile(ui, "out/secret.txt")).toBeNull();
    expect(await containedFile(ui, "again/app.js")).toBeNull();
    expect((await app.request("/ui/out/secret.txt")).status).toBe(404);
  });
});
