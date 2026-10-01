/**
 * The hot-update network gate (hmr/routes.ts): on a non-loopback bind, hot APIs require
 * real HTTPS. `x-forwarded-proto` is caller-supplied — trusting it unconditionally would
 * let ANY client walk through the gate over plaintext just by setting a header, which is
 * exactly the case the gate exists to block. It is honored only when the deployment
 * explicitly opts in (`trustProxy` / PENGUIN_TRUST_PROXY=1), same as a real reverse-proxy
 * setup requires.
 *
 * - On a non-loopback bind a spoofed `x-forwarded-proto` is refused by default, while real
 *   HTTPS on the request URL passes whatever trustProxy says.
 * - With trustProxy on, plain HTTP without the header is still refused, and the header is
 *   honored.
 * - A loopback bind needs neither HTTPS nor the header.
 *
 * A request past the gate meets the cookie check instead, so its 401 is the proof the gate let
 * it through.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import type { TestApp, TestAppOptions } from "./helpers.js";

/** One app per bind configuration: the gate reads only the request, so the cases share it. */
function bound(opts: TestAppOptions) {
  const app = { t: undefined as TestApp | undefined };
  beforeAll(async () => {
    app.t = await createTestApp(opts);
  });
  afterAll(async () => {
    await app.t?.cleanup();
  });
  return (url: string, headers: Record<string, string> = {}) =>
    app.t!.app.request(url, { method: "POST", headers });
}

describe("hmr network gate: a non-loopback bind, trustProxy off (the default)", () => {
  const upgrade = bound({ config: { host: "0.0.0.0" } });

  it("rejects a spoofed x-forwarded-proto header", async () => {
    const res = await upgrade("/api/hmr/upgrade", { "x-forwarded-proto": "https" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("hmr_disabled");
  });

  it("lets real HTTPS on the request URL itself through", async () => {
    expect((await upgrade("https://example.test/api/hmr/upgrade")).status).toBe(401);
  });
});

describe("hmr network gate: a non-loopback bind with trustProxy on", () => {
  const upgrade = bound({ config: { host: "0.0.0.0", trustProxy: true } });

  it("still refuses plain HTTP when no header is sent", async () => {
    expect((await upgrade("/api/hmr/upgrade")).status).toBe(403);
  });

  it("honors x-forwarded-proto", async () => {
    expect((await upgrade("/api/hmr/upgrade", { "x-forwarded-proto": "https" })).status).toBe(401);
  });
});

describe("hmr network gate: a loopback bind", () => {
  const upgrade = bound({}); // the default test config binds 127.0.0.1

  it("needs neither HTTPS nor the header", async () => {
    expect((await upgrade("/api/hmr/upgrade")).status).toBe(401);
  });
});
