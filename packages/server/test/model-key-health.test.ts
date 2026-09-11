import { describe, expect, it } from "vitest";
import { ModelKeyHealthService } from "../src/services/model-key-health.js";

describe("ModelKeyHealthService", () => {
  it("creates and caches key rotators for a model", () => {
    const service = new ModelKeyHealthService();
    const rotator1 = service.getRotator("deepseek/deepseek-chat", "sk-key-1, sk-key-2");
    const rotator2 = service.getRotator("deepseek/deepseek-chat");

    expect(rotator1).toBe(rotator2);
    expect(rotator1.totalKeys).toBe(2);
  });

  it("masks keys securely in status reports", () => {
    const service = new ModelKeyHealthService();
    service.getRotator("deepseek/deepseek-chat", "sk-1234567890abcdef");

    const report = service.getKeyHealth("deepseek/deepseek-chat");
    expect(report.modelRef).toBe("deepseek/deepseek-chat");
    expect(report.keys).toHaveLength(1);
    expect(report.keys[0].maskedKey).toBe("sk-...cdef");
    expect(report.keys[0].status).toBe("healthy");
    expect(report.keys[0].isFailed).toBe(false);
  });

  it("tracks cooldown and eviction in health report", () => {
    const service = new ModelKeyHealthService();
    const rotator = service.getRotator("deepseek/deepseek-chat", "sk-proj-key-1, sk-proj-key-2");

    rotator.markRateLimited("sk-proj-key-1", 30_000);
    rotator.markFailed("sk-proj-key-2");

    const report = service.getKeyHealth("deepseek/deepseek-chat");
    const key1 = report.keys.find((k) => k.maskedKey.endsWith("ey-1"));
    const key2 = report.keys.find((k) => k.maskedKey.endsWith("ey-2"));

    expect(key1?.status).toBe("cooldown");
    expect(key1?.cooldownRemainingMs).toBeGreaterThan(0);
    expect(key2?.status).toBe("evicted");
    expect(key2?.isFailed).toBe(true);
  });

  it("resets key health on demand", () => {
    const service = new ModelKeyHealthService();
    const rotator = service.getRotator("deepseek/deepseek-chat", "sk-proj-key-1, sk-proj-key-2");

    rotator.markRateLimited("sk-proj-key-1", 60_000);
    rotator.markFailed("sk-proj-key-2");

    service.resetKeyHealth("deepseek/deepseek-chat");

    const report = service.getKeyHealth("deepseek/deepseek-chat");
    expect(report.keys.every((k) => k.status === "healthy")).toBe(true);
    expect(report.keys.every((k) => !k.isFailed)).toBe(true);
  });
});
