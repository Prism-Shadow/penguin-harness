/**
 * The hot-update network gate (hmr/routes.ts): on a non-loopback bind, hot APIs require
 * real HTTPS. `x-forwarded-proto` is caller-supplied — trusting it unconditionally would
 * let ANY client walk through the gate over plaintext just by setting a header, which is
 * exactly the case the gate exists to block. It is honored only when the deployment
 * explicitly opts in (`trustProxy` / PENGUIN_TRUST_PROXY=1), same as a real reverse-proxy
 * setup requires.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("hmr network gate: non-loopback binds require real HTTPS", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    if (t) await t.cleanup();
    t = undefined;
  });

  it("rejects a spoofed x-forwarded-proto header by default (trustProxy off)", async () => {
    t = await createTestApp({ config: { host: "0.0.0.0" } });
    const res = await t.app.request("/api/hmr/upgrade", {
      method: "POST",
      headers: { "x-forwarded-proto": "https" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("hmr_disabled");
  });

  it("real HTTPS on the request URL itself passes the gate regardless of trustProxy", async () => {
    t = await createTestApp({ config: { host: "0.0.0.0" } });
    const res = await t.app.request("https://example.test/api/hmr/upgrade", { method: "POST" });
    // Past the network gate now — falls through to cookie auth, which rejects with 401
    // (no cookie sent), proving the gate itself let the request through.
    expect(res.status).toBe(401);
  });

  it("plain HTTP on the request URL is still refused when trustProxy is on (no header sent)", async () => {
    t = await createTestApp({ config: { host: "0.0.0.0", trustProxy: true } });
    const res = await t.app.request("/api/hmr/upgrade", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("honors x-forwarded-proto once trustProxy is explicitly enabled", async () => {
    t = await createTestApp({ config: { host: "0.0.0.0", trustProxy: true } });
    const res = await t.app.request("/api/hmr/upgrade", {
      method: "POST",
      headers: { "x-forwarded-proto": "https" },
    });
    // Past the network gate — rejected by the (missing) cookie instead.
    expect(res.status).toBe(401);
  });

  it("a loopback bind needs neither HTTPS nor the header", async () => {
    t = await createTestApp(); // default test config binds 127.0.0.1
    const res = await t.app.request("/api/hmr/upgrade", { method: "POST" });
    expect(res.status).toBe(401); // past the gate, rejected only by the missing cookie
  });
});
