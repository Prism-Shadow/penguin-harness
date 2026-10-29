/**
 * This server's JSON answers as any caller receives them over HTTP — a browser, or a hub
 * reading a machine (http/json-validators.ts, http/json-compression.ts).
 *
 * - Given a JSON read, its answer carries a validator; a caller presenting it again is answered
 *   304 with no body, and one presenting another gets the whole answer.
 * - Given a caller that accepts brotli, a JSON answer over 1 KiB comes back in brotli and decodes
 *   to the plain answer; one that refuses brotli (`q=0`) gets gzip; one that asks for nothing
 *   gets the plain answer; and a small answer stays plain whatever was asked.
 */
import zlib from "node:zlib";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const MODELS = "/api/projects/default_project/models";

describe("JSON answers", () => {
  let t: TestApp;
  let cookie = "";
  beforeAll(async () => {
    t = await createTestApp();
    cookie = (await loginAdmin(t.app)).cookie;
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const get = (path: string, headers: Record<string, string> = {}) =>
    t.app.request(path, { headers: { cookie, ...headers } });

  it("a caller holding the answer's validator is answered 304, and one holding another the whole answer", async () => {
    const first = await get(MODELS);
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^W\/"/);
    const plain = await first.text();

    const held = await get(MODELS, { "if-none-match": `"stale", ${etag}` });
    expect(held.status).toBe(304);
    expect(await held.text()).toBe("");

    const other = await get(MODELS, { "if-none-match": '"stale"' });
    expect(other.status).toBe(200);
    expect(await other.text()).toBe(plain);
  });

  it("is compressed in the best encoding the caller accepts, and only when worth it", async () => {
    const plain = Buffer.from(await (await get(MODELS)).arrayBuffer());

    const br = await get(MODELS, { "accept-encoding": "gzip, deflate, br" });
    expect(br.headers.get("content-encoding")).toBe("br");
    const brBytes = Buffer.from(await br.arrayBuffer());
    expect(zlib.brotliDecompressSync(brBytes).equals(plain)).toBe(true);
    expect(brBytes.byteLength).toBeLessThan(plain.byteLength / 4);

    const gzip = await get(MODELS, { "accept-encoding": "br;q=0, gzip" });
    expect(gzip.headers.get("content-encoding")).toBe("gzip");
    expect(zlib.gunzipSync(Buffer.from(await gzip.arrayBuffer())).equals(plain)).toBe(true);

    const none = await get(MODELS);
    expect(none.headers.get("content-encoding")).toBeNull();

    const small = await get("/api/me", { "accept-encoding": "br" });
    expect(small.status).toBe(200);
    expect(small.headers.get("content-encoding")).toBeNull();
    expect(((await small.json()) as { user: { userId: string } }).user.userId).toBe("admin");
  });
});
