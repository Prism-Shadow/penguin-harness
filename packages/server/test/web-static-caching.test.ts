/**
 * The SPA's caching contract — the piece that makes a hot-pushed web VISIBLE: without it,
 * whether a returning client ever saw a new push was left to browser heuristics. index.html
 * (and every SPA-fallback answer) must revalidate per navigation and flip on a push;
 * content-hashed assets must cache forever.
 */
import zlib from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("If-None-Match, as clients and proxies actually send it", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;
    expect((await pushWeb(t, cookie, "v1")).status).toBe(200);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const etagOfIndex = async () => (await t.app.request("/")).headers.get("etag")!;

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
    const etag = await etagOfIndex();
    const res = await t.app.request("/", { headers: { "if-none-match": `W/${etag}` } });
    expect(res.status).toBe(304);
  });

  it("treats * as a match, and an unrelated tag as a miss", async () => {
    expect((await t.app.request("/", { headers: { "if-none-match": "*" } })).status).toBe(304);
    expect((await t.app.request("/", { headers: { "if-none-match": '"nope"' } })).status).toBe(200);
  });
});

describe("web static caching, served from disk", () => {
  // The packaged install's path, and a SECOND implementation of the same contract: the disk
  // branch derives a weak size+mtime validator instead of hashing. Nothing above exercises
  // it, so without this the shipped half of the feature has no assertions on it at all.
  let t: TestApp;
  let webDist: string;

  beforeEach(async () => {
    webDist = path.join(await makeTempRoot(), "web");
    await fs.mkdir(path.join(webDist, "assets"), { recursive: true });
    await fs.writeFile(path.join(webDist, "index.html"), "<html>disk v1</html>");
    await fs.writeFile(path.join(webDist, "assets", "index-abc123.js"), 'console.log("v1")');
    t = await createTestApp({ config: { webDist } });
  });
  afterEach(async () => {
    await t.cleanup();
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
