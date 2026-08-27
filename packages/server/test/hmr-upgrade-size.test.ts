/**
 * The hot-update channel's own size bounds (hmr/routes.ts).
 *
 * A push is a whole web dist plus the platform's native assets, arriving as a gzip stream — so
 * the channel bounds both the compressed body and what it inflates to, rather than riding the
 * `/api/*` JSON cap, which has nothing to say about the second. The body bound sits ahead of the
 * channel's authentication, so an oversized push is cut off the stream rather than buffered
 * while its credentials are checked.
 */
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

describe("hot update payload bounds", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    if (t) await t.cleanup();
    t = undefined;
  });

  it("refuses an oversized push before the channel authenticates", async () => {
    t = await createTestApp();

    // A declared length over the bound, and no cookie: the bound short-circuits on the header
    // without reading the (tiny) body, so the answer names the size rather than the missing
    // credentials. A 401 here would mean the payload was being buffered before it was measured.
    const res = await t.app.request("/api/hmr/upgrade", {
      method: "POST",
      headers: {
        "content-type": "application/gzip",
        "content-length": String(512 * 1024 * 1024),
      },
      body: zlib.gzipSync(Buffer.from("{}")),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("payload_too_large");
    expect(body.error.message).toMatch(/Hot update payload/);
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

    // A few hundred kilobytes on the wire, 300MB once inflated. Streamed through gzip with
    // backpressure, so the test never holds the uncompressed form either.
    const gzip = zlib.createGzip();
    const chunks: Buffer[] = [];
    gzip.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve) => gzip.on("end", resolve));
    const megabyte = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < 300; i++) {
      if (!gzip.write(megabyte)) await new Promise((resolve) => gzip.once("drain", resolve));
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
    // Refused by the inflate bound, not by whatever JSON.parse makes of 300MB of NULs
    // after the process has already allocated all of it.
    expect(body.error.message).toMatch(/invalid gzip upgrade payload/);
    expect(body.error.message).toMatch(/Cannot create a Buffer larger than 268435456 bytes/);
  });
});
