/**
 * The model route's security surface: a safe relative path only, no traversal, no symlink
 * out, no directory configured no file at all — the twenty lines the module header calls
 * the pack's only door. The routes run against a real temp tree, the way the server's own
 * static file tests do.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cubismModelRoutes, settingsOf, CUBISM_GROUP } from "../src/index.js";

/** A Hono app driven by fetch, the way the browser drives it. */
function drive(app: unknown, p: string): Promise<Response> {
  // Hono's fetch: Promise<Response | undefined> — the routes here always answer.
  return (app as { fetch(r: Request): Promise<Response | undefined> }).fetch(
    new Request(`http://localhost/model/${p}`),
  ) as Promise<Response>;
}

async function pack() {
  const dir = await mkdtemp(path.join(tmpdir(), "pet-cubism-"));
  await writeFile(path.join(dir, "pet.model3.json"), '{"FileReferences":{"Moc":"pet.moc3"}}');
  await writeFile(path.join(dir, "pet.moc3"), "MOC3");
  await mkdir(path.join(dir, "tex"));
  await writeFile(path.join(dir, "tex", "face.png"), "PNG");
  return dir;
}

describe("cubismModelRoutes", () => {
  it("serves a named file of the configured pack", async () => {
    const dir = await pack();
    const app = cubismModelRoutes({ settings: () => ({ modelDir: dir }) });
    const res = await drive(app, "pet.moc3");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("MOC3");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("names the content type by extension", async () => {
    const dir = await pack();
    const app = cubismModelRoutes({ settings: () => ({ modelDir: dir }) });
    expect((await drive(app, "pet.model3.json")).headers.get("content-type")).toBe("application/json");
    expect((await drive(app, "tex/face.png")).headers.get("content-type")).toBe("image/png");
  });

  it("revalidates rather than caching for good", async () => {
    const dir = await pack();
    const app = cubismModelRoutes({ settings: () => ({ modelDir: dir }) });
    const res = await drive(app, "pet.moc3");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("answers 404 on every path when no model is configured", async () => {
    const app = cubismModelRoutes({ settings: () => ({ modelDir: "" }) });
    expect((await drive(app, "pet.moc3")).status).toBe(404);
  });

  it("answers 404 on a path that leaves the pack (.., absolute, backslash, empty)", async () => {
    const dir = await pack();
    const outside = await mkdtemp(path.join(tmpdir(), "pet-outside-"));
    await writeFile(path.join(outside, "secret"), "no");
    const app = cubismModelRoutes({ settings: () => ({ modelDir: dir }) });
    for (const bad of ["../secret", `../${path.basename(dir)}/../secret`, "/etc/passwd", "a\\b", "", "."]) {
      expect((await drive(app, bad)).status, bad).toBe(404);
    }
  });

  it("answers 404 through a symlink that leaves the pack", async () => {
    const dir = await pack();
    const outside = await mkdtemp(path.join(tmpdir(), "pet-outside-"));
    await writeFile(path.join(outside, "secret"), "no");
    await symlink(path.join(outside, "secret"), path.join(dir, "link"));
    const app = cubismModelRoutes({ settings: () => ({ modelDir: dir }) });
    expect((await drive(app, "link")).status).toBe(404);
  });

  it("answers 404 on a path that does not exist or is a directory", async () => {
    const dir = await pack();
    const app = cubismModelRoutes({ settings: () => ({ modelDir: dir }) });
    expect((await drive(app, "no-such-file")).status).toBe(404);
    expect((await drive(app, "tex")).status).toBe(404);
  });

  it("answers 404 on a percent-encoding that does not survive decoding", async () => {
    const dir = await pack();
    const app = cubismModelRoutes({ settings: () => ({ modelDir: dir }) });
    expect((await drive(app, "%")).status).toBe(404);
  });
});

describe("settingsOf", () => {
  it("reads the group's modelDir and defaults to empty", () => {
    expect(settingsOf({ [CUBISM_GROUP]: { modelDir: "/var/lib/pet-model" } })).toEqual({
      modelDir: "/var/lib/pet-model",
    });
    expect(settingsOf({})).toEqual({ modelDir: "" });
    expect(settingsOf(undefined)).toEqual({ modelDir: "" });
    expect(settingsOf({ [CUBISM_GROUP]: { modelDir: 42 } })).toEqual({ modelDir: "" });
  });
});
