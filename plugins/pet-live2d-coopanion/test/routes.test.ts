/**
 * The pack route's security surface: a safe relative path only, no traversal, no symlink
 * out, no installation configured no file at all — the twenty lines the module header
 * calls the installation's only door. The routes run against a real temp tree, the way
 * the server's own static file tests do.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { coopanionPackRoutes, settingsOf, COOPANION_GROUP } from "../src/index.js";

/** A Hono app driven by fetch, the way the browser drives it. */
function drive(app: unknown, p: string): Promise<Response> {
  // Hono's fetch: Promise<Response | undefined> — the routes here always answer.
  return (app as { fetch(r: Request): Promise<Response | undefined> }).fetch(
    new Request(`http://localhost/pack/${p}`),
  ) as Promise<Response>;
}

/** A stand-in installation: the manifest, a kit module and a texture's layout. */
async function pack() {
  const dir = await mkdtemp(path.join(tmpdir(), "pet-coopanion-"));
  await writeFile(path.join(dir, "figure.json"), '{"api":2,"entry":"figure.js","export":"createBody"}');
  await mkdir(path.join(dir, "kit"));
  await writeFile(path.join(dir, "kit", "body.js"), "export const createBody = () => ({});");
  await mkdir(path.join(dir, "tex"));
  await writeFile(path.join(dir, "tex", "face.png"), "PNG");
  return dir;
}

describe("coopanionPackRoutes", () => {
  it("serves a named file of the configured installation", async () => {
    const dir = await pack();
    const app = coopanionPackRoutes({ settings: () => ({ packDir: dir }) });
    const res = await drive(app, "kit/body.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("export const createBody = () => ({});");
    expect(res.headers.get("content-type")).toBe("text/javascript");
  });

  it("names the content type by extension", async () => {
    const dir = await pack();
    const app = coopanionPackRoutes({ settings: () => ({ packDir: dir }) });
    expect((await drive(app, "figure.json")).headers.get("content-type")).toBe("application/json");
    expect((await drive(app, "tex/face.png")).headers.get("content-type")).toBe("image/png");
  });

  it("revalidates rather than caching for good", async () => {
    const dir = await pack();
    const app = coopanionPackRoutes({ settings: () => ({ packDir: dir }) });
    expect((await drive(app, "figure.json")).headers.get("cache-control")).toBe("no-cache");
  });

  it("answers 404 on every path when no installation is configured", async () => {
    const app = coopanionPackRoutes({ settings: () => ({ packDir: "" }) });
    expect((await drive(app, "figure.json")).status).toBe(404);
  });

  it("answers 404 on a path that leaves the installation (.., absolute, backslash, empty)", async () => {
    const dir = await pack();
    const outside = await mkdtemp(path.join(tmpdir(), "pet-outside-"));
    await writeFile(path.join(outside, "secret"), "no");
    const app = coopanionPackRoutes({ settings: () => ({ packDir: dir }) });
    for (const bad of ["../secret", "/etc/passwd", "a\\b", "", "."]) {
      expect((await drive(app, bad)).status, bad).toBe(404);
    }
  });

  it("answers 404 through a symlink that leaves the installation", async () => {
    const dir = await pack();
    const outside = await mkdtemp(path.join(tmpdir(), "pet-outside-"));
    await writeFile(path.join(outside, "secret"), "no");
    await symlink(path.join(outside, "secret"), path.join(dir, "link"));
    const app = coopanionPackRoutes({ settings: () => ({ packDir: dir }) });
    expect((await drive(app, "link")).status).toBe(404);
  });

  it("answers 404 on a path that does not exist or is a directory", async () => {
    const dir = await pack();
    const app = coopanionPackRoutes({ settings: () => ({ packDir: dir }) });
    expect((await drive(app, "no-such-file")).status).toBe(404);
    expect((await drive(app, "kit")).status).toBe(404);
  });

  it("answers 404 on a percent-encoding that does not survive decoding", async () => {
    const dir = await pack();
    const app = coopanionPackRoutes({ settings: () => ({ packDir: dir }) });
    expect((await drive(app, "%")).status).toBe(404);
  });
});

describe("settingsOf", () => {
  it("reads the group's packDir and defaults to empty", () => {
    expect(settingsOf({ [COOPANION_GROUP]: { packDir: "/opt/coopanion/web" } })).toEqual({
      packDir: "/opt/coopanion/web",
    });
    expect(settingsOf({})).toEqual({ packDir: "" });
    expect(settingsOf(undefined)).toEqual({ packDir: "" });
    expect(settingsOf({ [COOPANION_GROUP]: { packDir: 42 } })).toEqual({ packDir: "" });
  });
});
