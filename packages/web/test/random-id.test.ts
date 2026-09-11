/**
 * randomHex (lib/random-id.ts), the generator behind parked-draft and shortcut ids. It has to
 * work in an insecure context — a Web App served over plain HTTP from any address but
 * localhost — where `crypto.randomUUID` does not exist and the previous generator threw on the
 * "+" button.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomHex } from "../src/lib/random-id";

describe("randomHex", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns exactly the requested number of lowercase hex characters", () => {
    for (const length of [1, 8, 12, 13, 32]) {
      expect(randomHex(length)).toMatch(new RegExp(`^[0-9a-f]{${length}}$`));
    }
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomHex(8)));
    expect(ids.size).toBe(200);
  });

  it("works where crypto.randomUUID is missing, as in an insecure context", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
    expect((globalThis.crypto as { randomUUID?: unknown }).randomUUID).toBeUndefined();
    expect(randomHex(8)).toMatch(/^[0-9a-f]{8}$/);
  });
});
