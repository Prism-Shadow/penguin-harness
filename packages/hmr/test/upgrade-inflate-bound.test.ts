/**
 * The upgrade body's inflate bound (main.ts, parseUpgradeTarget).
 *
 * Nothing limits how large a push may be. What is bounded is what its gzip body may INFLATE to,
 * and the bound is read from the platform rather than chosen: past MAX_STRING_LENGTH the payload
 * cannot become the string `JSON.parse` needs, whatever size a push is allowed to be. Without the
 * bound the process allocates until it dies, and never reaches the string that would have thrown.
 */
import { constants } from "node:buffer";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseUpgradeTarget } from "../src/main.js";

describe("upgrade payload inflate bound", () => {
  it("parses a push far larger than an ordinary API request", () => {
    // One incompressible dist file, stored rather than deflated, so the body really is tens of
    // megabytes instead of merely describing something that would be.
    const bulk = crypto.randomBytes(25 * 1024 * 1024).toString("base64");
    const body = zlib.gzipSync(
      Buffer.from(
        JSON.stringify({
          platform: "export const hotPlatform = {};\n",
          cli: "export async function cli() { return 0; }\n",
          web: {
            files: {
              "index.html": Buffer.from("<html>sized</html>").toString("base64"),
              "assets/bulk.bin": bulk,
            },
          },
        }),
      ),
      { level: 0 },
    );
    expect(body.length).toBeGreaterThan(32 * 1024 * 1024);

    const target = parseUpgradeTarget("application/gzip", body);
    expect(target.web["index.html"]).toBe(Buffer.from("<html>sized</html>").toString("base64"));
    expect(target.web["assets/bulk.bin"]).toBe(bulk);
  });

  it("refuses a payload that inflates past the bound instead of allocating it", async () => {
    // A few hundred kilobytes on the wire, past MAX_STRING_LENGTH once inflated. Streamed
    // through gzip with backpressure, so the test never holds the uncompressed form either.
    // Written in 16MB blocks rather than 1MB ones: the deflate work is what this costs, and
    // half a gigabyte of it in small writes is slow enough to time out under a loaded suite.
    const inflated = constants.MAX_STRING_LENGTH + 64 * 1024 * 1024;
    const block = Buffer.alloc(16 * 1024 * 1024);
    const gzip = zlib.createGzip();
    const chunks: Buffer[] = [];
    gzip.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve) => gzip.on("end", resolve));
    for (let written = 0; written < inflated; written += block.length) {
      if (!gzip.write(block)) await new Promise((resolve) => gzip.once("drain", resolve));
    }
    gzip.end();
    await done;
    const bomb = Buffer.concat(chunks);
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);

    // Refused by the inflate bound, not by whatever JSON.parse makes of half a gigabyte of NULs
    // after the process has already allocated all of it.
    expect(() => parseUpgradeTarget("application/gzip", bomb)).toThrow(
      new RegExp(
        `invalid gzip upgrade payload.*Cannot create a Buffer larger than ${constants.MAX_STRING_LENGTH} bytes`,
      ),
    );
    // Half a gigabyte of deflate plus the inflate that is then refused: generous enough that a
    // loaded suite cannot turn this into a timeout that reads as a broken bound.
  }, 60_000);
});
