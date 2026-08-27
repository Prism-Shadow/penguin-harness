/**
 * The hot-update channel's own size bounds (hmr/routes.ts).
 *
 * A push is a whole web dist plus the platform's native assets. It used to be governed by
 * the `/api/*` cap, which is derived from the admin-settable attachment budget — so turning
 * that budget down shrank the channel a broken installation is repaired through, and the
 * failure was a 413 on the one endpoint an operator cannot afford to lose. `/api/hmr` now
 * carries its own bound, on the compressed body and on what it inflates to alike.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { MIN_ATTACHMENT_MB, bodyLimitBytes } from "../src/services/attachment-limits.js";
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

  it("accepts a push larger than the admin attachment budget would ever allow", async () => {
    t = await createTestApp();
    const cookie = (await loginAdmin(t.app)).cookie;

    // The smallest budget an admin can set. Under the old wiring this number decided how
    // large a hot-update push could be.
    t.deps.serverSettingsRepo.setAttachmentMaxMb(MIN_ATTACHMENT_MB);
    t.deps.serverSettingsRepo.setAttachmentTotalMb(MIN_ATTACHMENT_MB);
    const attachmentCap = bodyLimitBytes({
      attachmentMaxMb: MIN_ATTACHMENT_MB,
      attachmentTotalMb: MIN_ATTACHMENT_MB,
    });

    // One incompressible dist file, stored rather than deflated, so the body on the wire is
    // genuinely over that cap instead of merely describing something that would be.
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
    expect(body.length).toBeGreaterThan(attachmentCap);

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
