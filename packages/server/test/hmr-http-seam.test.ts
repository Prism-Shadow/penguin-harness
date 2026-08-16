/**
 * The platform's HTTP seam: routes ship by push, not by rebuild.
 *
 * Until this existed, the route table was a runtime asset — every new or changed endpoint cost
 * a rebuild and a redeploy of every installation, which is the thing the hot channel exists to
 * avoid. These tests push a platform that serves HTTP and check the four properties that make
 * the seam usable and safe: a new route appears, an existing one can be replaced, the upgrade
 * channel cannot be claimed, and a platform that throws does not silently fall through to a
 * different implementation.
 */
import zlib from "node:zlib";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AppEnv } from "../src/auth/middleware.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const HTTP_BUNDLE_FILE = fileURLToPath(
  new URL("./fixtures/platform-http.bundle.mjs", import.meta.url),
);

const MINIMAL_CLI = "export async function cli(argv) { return 0; }\n";
const MINIMAL_WEB = { "index.html": Buffer.from("<html>seam</html>").toString("base64") };

async function pushPlatform(app: Hono<AppEnv>, cookie: string, platform: string) {
  const gz = zlib.gzipSync(
    Buffer.from(JSON.stringify({ platform, cli: MINIMAL_CLI, web: { files: MINIMAL_WEB } })),
  );
  return app.request("/api/hmr/upgrade", {
    method: "POST",
    headers: { cookie, "content-type": "application/gzip" },
    body: gz,
  });
}

describe("platform HTTP seam", () => {
  let t: TestApp;
  let cookie: string;
  let api: ReturnType<typeof apiClient>;
  let bundle: string;

  beforeEach(async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    cookie = admin.cookie;
    api = apiClient(t.app, cookie);
    bundle = await fs.readFile(HTTP_BUNDLE_FILE, "utf8");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("a pushed platform adds a route the runtime has never heard of", async () => {
    // Before: nothing serves it, and no rebuild is going to happen in between.
    expect((await api.get("/api/demo/ping")).status).toBe(404);

    expect((await pushPlatform(t.app, cookie, bundle)).status).toBe(200);

    const res = await api.get("/api/demo/ping");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true, from: "pushed-platform" });
  });

  it("…and can replace one the runtime already serves", async () => {
    const before = (await (await api.get("/api/version")).json()) as { version: string };
    expect(before.version).not.toBe("from-platform");

    await pushPlatform(t.app, cookie, bundle);

    expect(await (await api.get("/api/version")).json()).toEqual({ version: "from-platform" });
  });

  it("routes the platform declines still reach the runtime's own", async () => {
    await pushPlatform(t.app, cookie, bundle);
    const me = await api.get("/api/me");
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { userId: string } }).user.userId).toBe("admin");
  });

  it("cannot claim the upgrade channel — one bad push must not lock the box out", async () => {
    await pushPlatform(t.app, cookie, bundle);
    // The fixture answers 418 for anything under /api/hmr; the runtime never offers it.
    const status = await api.get("/api/hmr/platform");
    expect(status.status).toBe(200);
    expect(status.status).not.toBe(418);
    // …and the channel still accepts the next push, which is the property that matters.
    expect((await pushPlatform(t.app, cookie, bundle)).status).toBe(200);
  });

  it("a platform that throws answers 500 instead of quietly falling through", async () => {
    await pushPlatform(t.app, cookie, bundle);
    const res = await api.get("/api/demo/boom");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("platform_error");
    expect(body.error.message).toContain("deliberate platform failure");
  });

  it("a platform with no http handler leaves every runtime route as it was", async () => {
    // The packaged stub has none: this is the state every installation starts in, and the
    // state an older pushed bundle stays in.
    expect((await api.get("/api/me")).status).toBe(200);
    expect((await api.get("/api/demo/ping")).status).toBe(404);
  });
});
