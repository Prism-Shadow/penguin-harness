/**
 * A push is read as a stream and never held whole (packages/hmr's parseUpgradeTarget).
 *
 * The body is inflated as it arrives and every inline content value is decoded straight into
 * the blob store, so neither memory nor V8's ceiling on a string's length (MAX_STRING_LENGTH,
 * ~512MB) bounds how large a push may be. What these assert is the part that is easy to lose
 * without anything else going red: that the path keeps pace with its input instead of gathering
 * it first, and that reading JSON in pieces decodes exactly what JSON.parse would.
 */
import { constants } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { HmrHost, parseUpgradeTarget } from "@prismshadow/penguin-hmr";
import { packagedPlatform } from "../src/hmr/platform.js";

const MB = 1024 * 1024;

describe("a push is read as a stream, never held whole", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function freshHost(): { root: string; host: HmrHost } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hmr-push-streams-"));
    roots.push(root);
    return { root, host: new HmrHost(root, packagedPlatform) };
  }

  /** Bytes the blob writers have put on disk so far: the temp files still being filled. */
  function bytesOnDisk(root: string): number {
    const dir = path.join(root, "hmr", "store", "incoming");
    let total = 0;
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return 0;
    }
    for (const name of names) {
      try {
        total += fs.statSync(path.join(dir, name)).size;
      } catch {
        // renamed into the store between the listing and the stat
      }
    }
    return total;
  }

  const blobFile = (root: string, sha: string) =>
    path.join(root, "hmr", "store", "blobs", sha.slice(0, 2), sha);

  it("an inline asset longer than any V8 string lands on disk, never in memory", async () => {
    const { root, host } = freshHost();
    // One asset whose base64 alone is longer than any string V8 can hold, so the old
    // gunzip → toString → JSON.parse could not have read it at all. Its content is zeros ("A"
    // is base64 for zero bits), generated a piece at a time: the test never holds it either.
    const PIECE = MB;
    const chars = Math.ceil((constants.MAX_STRING_LENGTH + 64 * MB) / PIECE) * PIECE;
    const decoded = (chars / 4) * 3;
    const piece = "A".repeat(PIECE);
    // How far the decoded input may run ahead of what is on disk: the stream buffers between
    // the two (a piece here, gzip's and gunzip's windows, the reader's chunk, the file stream's
    // queue) and nothing else. A path that gathered the value first would be `decoded` behind.
    const WINDOW = 32 * MB;
    let produced = 0;
    let widest = 0;

    async function* text(): AsyncGenerator<string> {
      yield JSON.stringify({ platform: "export {};\n", cli: "export {};\n" }).slice(0, -1);
      yield ',"web":{"files":{"index.html":"PGh0bWw+"}},"assets":{"files":{"big.bin":"';
      for (let sent = 0; sent < chars; sent += PIECE) {
        widest = Math.max(widest, (produced / 4) * 3 - bytesOnDisk(root));
        produced += PIECE;
        yield piece;
      }
      yield '"},"exec":[]}}';
    }
    const body = Readable.from(text(), { highWaterMark: 1 }).pipe(zlib.createGzip({ level: 1 }));

    const lease = host.blobLease();
    try {
      const target = await parseUpgradeTarget("application/gzip", body, lease);
      expect(produced).toBe(chars);

      const zeros = Buffer.alloc(16 * MB);
      const hash = createHash("sha256");
      for (let left = decoded; left > 0; left -= zeros.length) {
        hash.update(left >= zeros.length ? zeros : zeros.subarray(0, left));
      }
      const sha = hash.digest("hex");
      expect(target.assets?.files["big.bin"]).toEqual({ sha });
      expect(fs.statSync(blobFile(root, sha)).size).toBe(decoded);

      expect(widest).toBeGreaterThanOrEqual(0);
      expect(widest).toBeLessThanOrEqual(WINDOW);
      // Nothing left behind but the blobs themselves.
      expect(bytesOnDisk(root)).toBe(0);
    } finally {
      lease.release();
    }
  }, 180_000);

  it("decodes escapes exactly as JSON.parse does, wherever a chunk boundary falls", async () => {
    // Escaped quotes and backslashes, control escapes, a character outside the BMP, and the
    // same again with every non-ASCII character written as \uXXXX — so a surrogate pair arrives
    // as two escapes that a piece boundary could fall between.
    const platform = 'export const s = "q\\"uote \\\\ back\nline\ttab é 😀  ";\n';
    const index = "<html>ü 😀</html>";
    const payload = JSON.stringify({
      platform,
      cli: "export {};\n",
      web: { files: { "index.html": Buffer.from(index).toString("base64") } },
      extra: [1, { a: null }, true, "unknown fields are skipped"],
      source: { repo: "https://example.test/r.git", revision: "v1" },
    });
    const escaped = payload.replace(
      /[\u0080-￿]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
    expect(JSON.parse(escaped)).toEqual(JSON.parse(payload));

    for (const text of [payload, escaped]) {
      const { root, host } = freshHost();
      // Stored rather than deflated, and fed one byte at a time: the inflated text then
      // reaches the reader in pieces of a few bytes, so boundaries land inside escapes too.
      const gz = zlib.gzipSync(Buffer.from(text), { level: 0 });
      async function* bytewise(): AsyncGenerator<Buffer> {
        for (let i = 0; i < gz.length; i++) yield gz.subarray(i, i + 1);
      }
      const lease = host.blobLease();
      try {
        const target = await parseUpgradeTarget("application/gzip", bytewise(), lease);
        expect(fs.readFileSync(blobFile(root, target.platform.sha), "utf8")).toBe(platform);
        expect(fs.readFileSync(blobFile(root, target.web["index.html"]!.sha), "utf8")).toBe(index);
        expect(target.source).toEqual({ repo: "https://example.test/r.git", revision: "v1" });
      } finally {
        lease.release();
      }
    }
  });
});
