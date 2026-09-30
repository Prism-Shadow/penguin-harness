/**
 * The SPA's caching contract — what makes a hot-pushed web VISIBLE: without it, whether a
 * returning client ever saw a new push was left to browser heuristics.
 *
 * - index.html, and every SPA-fallback answer, revalidates per navigation (`no-cache` plus an
 *   ETag); content-hashed assets cache forever.
 * - A matching If-None-Match answers 304 with no body and the same contract; a match is found
 *   in a list of tags, through a proxy's weak `W/` downgrade, and for `*`; an unrelated tag is
 *   a miss.
 * - A new push changes the ETag, so the next navigation gets the new app.
 * - Served from disk (the packaged install) the same contract holds, with a weak size+mtime
 *   validator that moves when the file changes.
 */
import zlib from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const MINIMAL_CLI = "export async function cli(argv) { return 0; }\n";
// Any bundle that boots will do — the subject here is the WEB half of the same push, and
// this is the fixture the seam tests already keep working.
const PLATFORM_BUNDLE_FILE = fileURLToPath(
  new URL("./fixtures/platform-http.bundle.mjs", import.meta.url),
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

describe("web static caching, from a pushed web", () => {
  let t: TestApp;
  let cookie: string;

  // One push serves the read-only cases; the last case pushes again.
  beforeAll(async () => {
    t = await createTestApp();
    cookie = (await loginAdmin(t.app)).cookie;
    expect((await pushWeb(t, cookie, "v1")).status).toBe(200);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const etagOfIndex = async () => (await t.app.request("/")).headers.get("etag")!;

  it("revalidates index.html per navigation, and caches hashed assets forever", async () => {
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

  it("answers a matching ETag with a bodiless 304 that keeps the contract", async () => {
    const revalidated = await t.app.request("/", {
      headers: { "if-none-match": await etagOfIndex() },
    });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");
    // Still carries the contract, so the client keeps revalidating next time.
    expect(revalidated.headers.get("cache-control")).toBe("no-cache");
  });

  it("matches one tag out of a list", async () => {
    // RFC 9110 allows a list, and a client holding several validators sends one.
    const etag = await etagOfIndex();
    const res = await t.app.request("/", {
      headers: { "if-none-match": `"stale-one", ${etag}, W/"another"` },
    });
    expect(res.status).toBe(304);
  });

  it("matches weakly, so a proxy's W/ downgrade still revalidates", async () => {
    // A re-encoding proxy (nginx's gzip module is the usual one) turns a strong ETag weak on
    // the way out; the client returns what it was given. A string compare misses this and
    // silently re-downloads the app on every navigation.
    const res = await t.app.request("/", {
      headers: { "if-none-match": `W/${await etagOfIndex()}` },
    });
    expect(res.status).toBe(304);
  });

  it("treats * as a match, and an unrelated tag as a miss", async () => {
    expect((await t.app.request("/", { headers: { "if-none-match": "*" } })).status).toBe(304);
    expect((await t.app.request("/", { headers: { "if-none-match": '"nope"' } })).status).toBe(200);
  });

  it("changes the ETag on a new push, so the next navigation gets the new app", async () => {
    const v1Etag = await etagOfIndex();
    expect((await pushWeb(t, cookie, "v2")).status).toBe(200);
    // The old ETag no longer matches: full 200 with the new bytes, not a 304.
    const after = await t.app.request("/", { headers: { "if-none-match": v1Etag } });
    expect(after.status).toBe(200);
    expect(await after.text()).toContain("v2");
    expect(after.headers.get("etag")).not.toBe(v1Etag);
  });
});

describe("web static caching, served from disk", () => {
  // The packaged install's path, and a SECOND implementation of the same contract: the disk
  // branch derives a weak size+mtime validator instead of hashing. Nothing above exercises
  // it, so without this the shipped half of the feature has no assertions on it at all.
  let t: TestApp;
  let webDist: string;

  // The last case rewrites index.html; the others only read.
  beforeAll(async () => {
    webDist = path.join(await makeTempRoot(), "web");
    await fs.mkdir(path.join(webDist, "assets"), { recursive: true });
    await fs.writeFile(path.join(webDist, "index.html"), "<html>disk v1</html>");
    await fs.writeFile(path.join(webDist, "assets", "index-abc123.js"), 'console.log("v1")');
    t = await createTestApp({ config: { webDist } });
  });
  afterAll(async () => {
    await t.cleanup();
    await fs.rm(path.dirname(webDist), { recursive: true, force: true });
  });

  it("applies the same contract, with a weak validator", async () => {
    const index = await t.app.request("/");
    expect(index.status).toBe(200);
    expect(index.headers.get("cache-control")).toBe("no-cache");
    // Weak on purpose: size+mtime describes the file without reading it twice.
    expect(index.headers.get("etag")).toMatch(/^W\/"\d+-\d+"$/);

    const asset = await t.app.request("/assets/index-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    // The asset rule keys off the SERVED path, which on this branch is rebuilt from the
    // filesystem path — on Windows with backslashes, if nothing normalizes it.
    expect(asset.headers.get("etag")).toBeTruthy();
  });

  it("revalidates the SPA fallback as index.html", async () => {
    const index = await t.app.request("/");
    const fallback = await t.app.request("/chat/new");
    expect(fallback.status).toBe(200);
    expect(fallback.headers.get("cache-control")).toBe("no-cache");
    expect(fallback.headers.get("etag")).toBe(index.headers.get("etag"));
  });

  it("answers 304 on a match, and 200 once the file changes", async () => {
    const etag = (await t.app.request("/")).headers.get("etag")!;
    const same = await t.app.request("/", { headers: { "if-none-match": etag } });
    expect(same.status).toBe(304);
    expect(await same.text()).toBe("");

    // A different length moves the validator without depending on clock resolution — an
    // mtime-only change can land inside the same millisecond on a fast filesystem.
    await fs.writeFile(path.join(webDist, "index.html"), "<html>disk v2 (longer)</html>");
    const after = await t.app.request("/", { headers: { "if-none-match": etag } });
    expect(after.status).toBe(200);
    expect(await after.text()).toContain("v2");
    expect(after.headers.get("etag")).not.toBe(etag);
  });
});
