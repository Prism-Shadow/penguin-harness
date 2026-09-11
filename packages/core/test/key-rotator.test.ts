import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyRotator, parseApiKeys } from "../src/llm/key-rotator.js";

describe("parseApiKeys", () => {
  it("returns empty array for undefined or empty string", () => {
    expect(parseApiKeys(undefined)).toEqual([]);
    expect(parseApiKeys("")).toEqual([]);
    expect(parseApiKeys("   ")).toEqual([]);
    expect(parseApiKeys([])).toEqual([]);
  });

  it("handles single API key", () => {
    expect(parseApiKeys("sk-test-12345")).toEqual(["sk-test-12345"]);
    expect(parseApiKeys("  sk-test-12345  ")).toEqual(["sk-test-12345"]);
  });

  it("parses comma-delimited keys", () => {
    expect(parseApiKeys("sk-key-1,sk-key-2,sk-key-3")).toEqual([
      "sk-key-1",
      "sk-key-2",
      "sk-key-3",
    ]);
    expect(parseApiKeys("sk-key-1,  sk-key-2  , sk-key-3")).toEqual([
      "sk-key-1",
      "sk-key-2",
      "sk-key-3",
    ]);
  });

  it("parses newline-delimited keys", () => {
    const raw = `sk-key-1
sk-key-2
sk-key-3`;
    expect(parseApiKeys(raw)).toEqual(["sk-key-1", "sk-key-2", "sk-key-3"]);
  });

  it("parses semicolon-delimited and mixed-delimited keys", () => {
    expect(parseApiKeys("sk-key-1;sk-key-2\nsk-key-3,sk-key-4")).toEqual([
      "sk-key-1",
      "sk-key-2",
      "sk-key-3",
      "sk-key-4",
    ]);
  });

  it("handles array of keys, trims, and filters empty strings", () => {
    expect(parseApiKeys(["sk-key-1", "  sk-key-2 ", "", "   ", "sk-key-3"])).toEqual([
      "sk-key-1",
      "sk-key-2",
      "sk-key-3",
    ]);
  });

  it("deduplicates keys while preserving initial order", () => {
    expect(parseApiKeys(["sk-key-1", "sk-key-2", "sk-key-1", "sk-key-3", "sk-key-2"])).toEqual([
      "sk-key-1",
      "sk-key-2",
      "sk-key-3",
    ]);
    expect(parseApiKeys("sk-key-1, sk-key-2, sk-key-1")).toEqual(["sk-key-1", "sk-key-2"]);
  });
});

describe("ApiKeyRotator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles empty key rotator", () => {
    const rotator = new ApiKeyRotator([]);
    expect(rotator.nextKey()).toBeUndefined();
    expect(rotator.hasWorkingKeys()).toBe(false);
    expect(rotator.getKeyStatuses()).toEqual([]);
  });

  it("rotates single key repeatedly", () => {
    const rotator = new ApiKeyRotator(["key-1"]);
    expect(rotator.hasWorkingKeys()).toBe(true);
    expect(rotator.nextKey()).toBe("key-1");
    expect(rotator.nextKey()).toBe("key-1");
    expect(rotator.nextKey()).toBe("key-1");
  });

  it("round-robins across multiple healthy keys", () => {
    const rotator = new ApiKeyRotator(["key-1", "key-2", "key-3"]);
    expect(rotator.nextKey()).toBe("key-1");
    expect(rotator.nextKey()).toBe("key-2");
    expect(rotator.nextKey()).toBe("key-3");
    expect(rotator.nextKey()).toBe("key-1");
    expect(rotator.nextKey()).toBe("key-2");
  });

  it("records success and increments successCount", () => {
    const rotator = new ApiKeyRotator(["key-1", "key-2"]);
    rotator.recordSuccess("key-1");
    rotator.recordSuccess("key-1");
    const statuses = rotator.getKeyStatuses();
    const k1 = statuses.find((s) => s.key === "key-1");
    expect(k1?.successCount).toBe(2);
    expect(k1?.failureCount).toBe(0);
    expect(k1?.status).toBe("healthy");
  });

  it("cooldowns key on rate_limit and automatically skips it during cooldown", () => {
    const rotator = new ApiKeyRotator(["key-1", "key-2", "key-3"], {
      rateLimitCooldownMs: 10_000,
    });

    expect(rotator.nextKey()).toBe("key-1");
    // Mark key-1 as rate-limited
    rotator.recordFailure("key-1", "rate_limit");

    const statuses = rotator.getKeyStatuses();
    const k1 = statuses.find((s) => s.key === "key-1");
    expect(k1?.status).toBe("cooldown");
    expect(k1?.cooldownUntil).toBeGreaterThan(Date.now());

    // Next keys should skip key-1
    expect(rotator.nextKey()).toBe("key-2");
    expect(rotator.nextKey()).toBe("key-3");
    expect(rotator.nextKey()).toBe("key-2");
    expect(rotator.nextKey()).toBe("key-3");

    // Advance time past cooldown
    vi.advanceTimersByTime(11_000);

    // key-1 is now available again
    const nextKeys = [rotator.nextKey(), rotator.nextKey(), rotator.nextKey()];
    expect(nextKeys).toContain("key-1");
  });

  it("evicts key permanently on auth failure and continues with remaining keys", () => {
    const rotator = new ApiKeyRotator(["key-1", "key-2"]);

    expect(rotator.nextKey()).toBe("key-1");
    // key-1 gets 401 Unauthorized
    rotator.recordFailure("key-1", "auth");

    const statuses = rotator.getKeyStatuses();
    const k1 = statuses.find((s) => s.key === "key-1");
    expect(k1?.status).toBe("evicted");
    expect(rotator.hasWorkingKeys()).toBe(true);

    // key-1 is never returned again
    expect(rotator.nextKey()).toBe("key-2");
    expect(rotator.nextKey()).toBe("key-2");
    expect(rotator.nextKey()).toBe("key-2");

    // Even if time advances, evicted key stays evicted
    vi.advanceTimersByTime(100_000);
    expect(rotator.nextKey()).toBe("key-2");

    // Now key-2 fails auth as well
    rotator.recordFailure("key-2", "auth");
    expect(rotator.hasWorkingKeys()).toBe(false);
    expect(rotator.nextKey()).toBeUndefined();
  });

  it("handles fallback to best available key when all are in cooldown", () => {
    const rotator = new ApiKeyRotator(["key-1", "key-2"], {
      rateLimitCooldownMs: 30_000,
    });

    rotator.recordFailure("key-1", "rate_limit");
    rotator.recordFailure("key-2", "rate_limit");

    // hasWorkingKeys returns true because cooldown keys are recoverable (not evicted)
    expect(rotator.hasWorkingKeys()).toBe(true);

    // When all are in cooldown, nextKey picks the one whose cooldown expires earliest
    const fallback = rotator.nextKey();
    expect(fallback).toBeDefined();
    expect(["key-1", "key-2"]).toContain(fallback);
  });

  it("resets all key states and cooldowns on reset()", () => {
    const rotator = new ApiKeyRotator(["key-1", "key-2"]);
    rotator.recordFailure("key-1", "auth");
    rotator.recordFailure("key-2", "rate_limit");

    rotator.reset();

    const statuses = rotator.getKeyStatuses();
    expect(statuses.every((s) => s.status === "healthy")).toBe(true);
    expect(statuses.every((s) => s.cooldownUntil === 0)).toBe(true);
    expect(rotator.hasWorkingKeys()).toBe(true);
    expect(rotator.nextKey()).toBe("key-1");
  });
});
