/**
 * The hot-update channel's inflate bound (hmr/routes.ts).
 *
 * Nothing limits how large a push may be. What is bounded is what a gzip body may INFLATE to,
 * and the bound is read from the platform rather than chosen: past MAX_STRING_LENGTH the payload
 * cannot become the string `JSON.parse` needs, whatever size a push is allowed to be. Without the
 * bound the process allocates until it dies, and never reaches the string that would have thrown.
 */
import { constants } from "node:buffer";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const MINIMAL_PLATFORM = `
const anySchema = {
  strictParse: (doc) => ({ ok: true, value: doc === undefined ? {} : doc }),
  describe: () => ({ kind: "any" }),
};
const iface = {
  kind: "iface",
  name: "platform",
  version: 1,
  context: anySchema,
  methods: ["park", "info"],
  children: {},
  migrations: {},
};
const impl = {
  create(_ctx, context) {
    return { park: () => context, info: () => ({ impl: "sized" }) };
  },
};
export const hotPlatform = { id: "sized", iface, impl, context: {} };
`;

const MINIMAL_CLI = "export async function cli(argv) { return 0; }\n";

describe("hot update inflate bound", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    if (t) await t.cleanup();
    t = undefined;
  });

  it("carries a push far larger than an ordinary API request", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;

    // One incompressible dist file, stored rather than deflated, so the body on the wire really
    // is tens of megabytes instead of merely describing something that would be.
    const bulk = crypto.randomBytes(25 * 1024 * 1024).toString("base64");
    const body = zlib.gzipSync(
      Buffer.from(
        JSON.stringify({
          platform: MINIMAL_PLATFORM,
          cli: MINIMAL_CLI,
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

    const res = await t.app.request("/api/hmr/upgrade", {
      method: "POST",
      headers: { cookie, "content-type": "application/gzip" },
      body,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
  });

  it("refuses a payload that inflates past the bound instead of allocating it", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;

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

    const res = await t.app.request("/api/hmr/upgrade", {
      method: "POST",
      headers: { cookie, "content-type": "application/gzip" },
      body: bomb,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("bad_request");
    // Refused by the inflate bound, not by whatever JSON.parse makes of half a gigabyte of NULs
    // after the process has already allocated all of it.
    expect(body.error.message).toMatch(/invalid gzip upgrade payload/);
    expect(body.error.message).toMatch(
      new RegExp(`Cannot create a Buffer larger than ${constants.MAX_STRING_LENGTH} bytes`),
    );
    // Half a gigabyte of deflate plus the inflate the server then refuses: generous enough that
    // a loaded suite cannot turn this into a timeout that reads as a broken bound.
  }, 60_000);
});
