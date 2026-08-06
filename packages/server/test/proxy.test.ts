/**
 * Unit tests for the outbound-proxy module's pure parts: the NO_PROXY loopback merge
 * and the dispatcher choice per switch state. No real network and no global install —
 * installGlobalProxyDispatcher (fetch replacement) runs only in the production entry.
 */
import { describe, expect, it } from "vitest";
import { Agent, EnvHttpProxyAgent } from "undici";
import { buildProxyDispatcher, mergedNoProxy } from "../src/net/proxy.js";

describe("mergedNoProxy", () => {
  it("yields exactly the loopback names when the environment has no NO_PROXY", () => {
    expect(mergedNoProxy({})).toBe("localhost,127.0.0.1,::1");
  });

  it("appends the loopback names after the environment's entries", () => {
    expect(mergedNoProxy({ NO_PROXY: "example.com,.corp.internal" })).toBe(
      "example.com,.corp.internal,localhost,127.0.0.1,::1",
    );
  });

  it("prefers the lowercase spelling, like undici itself", () => {
    expect(mergedNoProxy({ no_proxy: "a.example", NO_PROXY: "b.example" })).toBe(
      "a.example,localhost,127.0.0.1,::1",
    );
  });

  it("does not duplicate loopback names already present (case-insensitively)", () => {
    expect(mergedNoProxy({ NO_PROXY: "LOCALHOST,::1" })).toBe("LOCALHOST,::1,127.0.0.1");
  });

  it("survives messy separators (comma/whitespace mix, empty segments)", () => {
    expect(mergedNoProxy({ NO_PROXY: " example.com ,, other.example " })).toBe(
      "example.com,other.example,localhost,127.0.0.1,::1",
    );
  });
});

describe("buildProxyDispatcher", () => {
  it("on → EnvHttpProxyAgent (proxy env honored), off → plain Agent (direct)", async () => {
    const on = buildProxyDispatcher(true, {});
    const off = buildProxyDispatcher(false, {});
    try {
      expect(on).toBeInstanceOf(EnvHttpProxyAgent);
      expect(off).toBeInstanceOf(Agent);
      expect(off).not.toBeInstanceOf(EnvHttpProxyAgent);
    } finally {
      await on.close();
      await off.close();
    }
  });
});
