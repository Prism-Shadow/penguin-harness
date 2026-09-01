/**
 * Negotiated compression for the static frontend (app.ts).
 *
 * The app bundle is over a megabyte of JavaScript and was served uncompressed, which is the
 * single largest thing a first load waits on. What makes this worth testing rather than
 * assuming is that every way of getting it wrong produces a response that LOOKS fine:
 *
 * - Compressing for a client that did not ask yields bytes it cannot decode — and `q=0` is a
 *   refusal that reads like consent to any substring match.
 * - Omitting `Vary: Accept-Encoding` lets a shared cache hand one client's gzip to another.
 * - Recompressing an already-compressed asset spends CPU to send more bytes.
 */
import zlib from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** Comfortably over the compress-worth-it threshold, and highly compressible. */
const BIG_JS = `console.log("${"x".repeat(4000)}");\n`;

describe("static compression", () => {
  let t: TestApp;
  let webDist: string;

  beforeEach(async () => {
    webDist = path.join(await makeTempRoot(), "web");
    await fs.mkdir(path.join(webDist, "assets"), { recursive: true });
    await fs.writeFile(path.join(webDist, "index.html"), `<html>${"y".repeat(4000)}</html>`);
    await fs.writeFile(path.join(webDist, "assets", "index-abc123.js"), BIG_JS);
    // Already compressed, and small: neither should be re-encoded.
    await fs.writeFile(path.join(webDist, "assets", "logo-abc123.png"), Buffer.alloc(4000, 7));
    await fs.writeFile(path.join(webDist, "assets", "tiny-abc123.js"), "let a=1;\n");
    t = await createTestApp({ config: { webDist } });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const get = (p: string, accept?: string) =>
    t.app.request(p, accept === undefined ? undefined : { headers: { "accept-encoding": accept } });

  it("sends brotli when offered, and it round-trips to the original bytes", async () => {
    const res = await get("/assets/index-abc123.js", "gzip, deflate, br");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(res.headers.get("vary")).toBe("Accept-Encoding");
    const body = Buffer.from(await res.arrayBuffer());
    expect(zlib.brotliDecompressSync(body).toString()).toBe(BIG_JS);
    // The whole point: meaningfully smaller than what was being sent before.
    expect(body.byteLength).toBeLessThan(BIG_JS.length / 4);
  });

  it("falls back to gzip, and to nothing at all", async () => {
    const gz = await get("/assets/index-abc123.js", "gzip");
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    expect(zlib.gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).toBe(BIG_JS);

    const plain = await get("/assets/index-abc123.js");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.text()).toBe(BIG_JS);
    // Vary is still announced: the answer COULD have varied, and a shared cache has to know.
    expect(plain.headers.get("vary")).toBe("Accept-Encoding");
  });

  it("reads q=0 as a refusal, not as consent", async () => {
    // The classic substring bug: `includes("gzip")` returns bytes this client just said it
    // cannot take, and the failure surfaces as a corrupt script, not as an error.
    const res = await get("/assets/index-abc123.js", "gzip;q=0");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe(BIG_JS);
  });

  it("leaves already-compressed and tiny files alone", async () => {
    const png = await get("/assets/logo-abc123.png", "br, gzip");
    expect(png.headers.get("content-encoding")).toBeNull();
    // Not even Vary: this response never depended on Accept-Encoding.
    expect(png.headers.get("vary")).toBeNull();

    const tiny = await get("/assets/tiny-abc123.js", "br, gzip");
    expect(tiny.headers.get("content-encoding")).toBeNull();
    expect(tiny.headers.get("vary")).toBeNull();
  });

  it("keeps the caching contract, with a weak validator on the compressed form", async () => {
    const plain = await get("/index.html");
    const br = await get("/index.html", "br");
    expect(plain.headers.get("cache-control")).toBe("no-cache");
    expect(br.headers.get("cache-control")).toBe("no-cache");
    // Different representations of the same thing, so the compressed one is weak — which is
    // precisely what a weak validator means.
    expect(br.headers.get("etag")).toMatch(/^W\//);

    // And revalidation still works from either spelling, including the 304's own tag.
    const revalidated = await t.app.request("/index.html", {
      headers: { "accept-encoding": "br", "if-none-match": br.headers.get("etag")! },
    });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("etag")).toBe(br.headers.get("etag"));
    expect(revalidated.headers.get("vary")).toBe("Accept-Encoding");
  });
});
