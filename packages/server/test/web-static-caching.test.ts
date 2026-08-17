/**
 * The SPA's caching contract — the piece that makes a hot-pushed web VISIBLE: without it,
 * whether a returning client ever saw a new push was left to browser heuristics. index.html
 * (and every SPA-fallback answer) must revalidate per navigation and flip on a push;
 * content-hashed assets must cache forever.
 */
import zlib from "node:zlib";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const MINIMAL_CLI = "export async function cli(argv) { return 0; }\n";
const PLATFORM_BUNDLE_FILE = fileURLToPath(
  new URL("./fixtures/platform-next.bundle.mjs", import.meta.url),
);

const webFiles = (marker: string) => ({
  "index.html": Buffer.from(`<html>${marker}</html>`).toString("base64"),
  "assets/index-abc123.js": Buffer.from(`console.log("${marker}")`).toString("base64"),
});

async function pushWeb(t: TestApp, cookie: string, marker: string) {
  const platform = await fs.readFile(PLATFORM_BUNDLE_FILE, "utf8");
  const gz = zlib.gzipSync(
    Buffer.from(
      JSON.stringify({
        platform,
        cli: MINIMAL_CLI,
        web: { files: webFiles(marker) },
      }),
    ),
  );
  return t.app.request("/api/hmr/upgrade", {
    method: "POST",
    headers: { cookie, "content-type": "application/gzip" },
    body: gz,
  });
}

describe("web static caching", () => {
  let t: TestApp;
  let cookie: string;

  beforeEach(async () => {
    t = await createTestApp();
    cookie = (await loginAdmin(t.app)).cookie;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("index.html revalidates per navigation; hashed assets cache forever", async () => {
    expect((await pushWeb(t, cookie, "v1")).status).toBe(200);

    const index = await t.app.request("/");
    expect(index.status).toBe(200);
    expect(index.headers.get("cache-control")).toBe("no-cache");
    const etag = index.headers.get("etag");
    expect(etag).toBeTruthy();

    // The SPA fallback is index.html under another name: same contract.
    const fallback = await t.app.request("/chat/new");
    expect(fallback.headers.get("cache-control")).toBe("no-cache");
    expect(fallback.headers.get("etag")).toBe(etag);

    const asset = await t.app.request("/assets/index-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("a matching ETag answers 304 with no body", async () => {
    expect((await pushWeb(t, cookie, "v1")).status).toBe(200);
    const first = await t.app.request("/");
    const etag = first.headers.get("etag")!;
    const revalidated = await t.app.request("/", { headers: { "if-none-match": etag } });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");
    // Still carries the contract, so the client keeps revalidating next time.
    expect(revalidated.headers.get("cache-control")).toBe("no-cache");
  });

  it("a new push changes the ETag, so the next navigation gets the new app", async () => {
    expect((await pushWeb(t, cookie, "v1")).status).toBe(200);
    const v1 = await t.app.request("/");
    const v1Etag = v1.headers.get("etag")!;

    expect((await pushWeb(t, cookie, "v2")).status).toBe(200);
    // The old ETag no longer matches: full 200 with the new bytes, not a 304.
    const after = await t.app.request("/", { headers: { "if-none-match": v1Etag } });
    expect(after.status).toBe(200);
    expect(await after.text()).toContain("v2");
    expect(after.headers.get("etag")).not.toBe(v1Etag);
  });
});
