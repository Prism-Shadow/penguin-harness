/**
 * The client-side id generator (random-uuid.ts): the draft screen's ids must be mintable in
 * every context the harness is served from, including the plain-HTTP LAN address where
 * `crypto.randomUUID` does not exist, and must keep the v4 shape the callers slice up.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUuid } from "../src/lib/random-uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("randomUuid", () => {
  it("returns a v4 UUID, distinct per call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomUuid()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(V4);
  });

  it("does not need crypto.randomUUID (absent in a non-secure context)", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Crypto.prototype, "randomUUID");
    Object.defineProperty(Crypto.prototype, "randomUUID", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      expect(randomUuid()).toMatch(V4);
    } finally {
      if (descriptor) Object.defineProperty(Crypto.prototype, "randomUUID", descriptor);
      else delete (Crypto.prototype as { randomUUID?: unknown }).randomUUID;
    }
  });

  it("still returns an id when there is no Web Crypto at all", () => {
    vi.stubGlobal("crypto", {});
    expect(randomUuid()).toMatch(V4);
  });
});
