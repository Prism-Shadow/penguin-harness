/**
 * Client-side whole-request gzip (#521): compress only when it strictly pays, fall back to
 * plain JSON for everything else.
 */
import zlib from "node:zlib";
import { describe, expect, it, afterEach } from "vitest";
import { gzipIfBeneficial, MIN_GZIP_BYTES } from "../src/api/gzip";

const savedCompressionStream = (globalThis as { CompressionStream?: unknown }).CompressionStream;

afterEach(() => {
  (globalThis as { CompressionStream?: unknown }).CompressionStream = savedCompressionStream;
});

describe("gzipIfBeneficial", () => {
  it("compresses repetitive payloads to a fraction, round-tripping losslessly", async () => {
    const json = JSON.stringify({ input: [{ type: "text", text: "INFO ok\n".repeat(5000) }] });
    expect(json.length).toBeGreaterThan(MIN_GZIP_BYTES);
    const gzipped = await gzipIfBeneficial(json);
    expect(gzipped).not.toBeNull();
    expect(gzipped!.length).toBeLessThan(json.length / 4);
    expect(zlib.gunzipSync(gzipped!).toString("utf8")).toBe(json);
  });

  it("skips bodies below the size floor without touching the compressor", async () => {
    expect(await gzipIfBeneficial('{"input":[]}')).toBeNull();
  });

  it("discards a result that is not smaller than the input", async () => {
    // A stub compressor that grows the body (framing with no redundancy to remove, as for
    // an already-compressed payload): the result is dropped rather than sent.
    const input = "x".repeat(2048);
    class GrowingStream {
      readable: ReadableStream;
      writable = new WritableStream();
      constructor() {
        const bytes = new TextEncoder().encode(input + "!");
        this.readable = new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
      }
    }
    (globalThis as { CompressionStream?: unknown }).CompressionStream =
      GrowingStream as unknown as typeof CompressionStream;
    expect(await gzipIfBeneficial(input)).toBeNull();
  });

  it("falls back to null when CompressionStream is unavailable", async () => {
    (globalThis as { CompressionStream?: unknown }).CompressionStream = undefined;
    const json = JSON.stringify({ input: [{ type: "text", text: "x".repeat(5000) }] });
    expect(await gzipIfBeneficial(json)).toBeNull();
  });
});
