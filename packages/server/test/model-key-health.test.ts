import { beforeEach, describe, expect, it } from "vitest";
import { ModelKeyHealthService } from "../src/services/model-key-health.js";

describe("ModelKeyHealthService", () => {
  let service: ModelKeyHealthService;

  beforeEach(() => {
    service = new ModelKeyHealthService();
    service.clear();
  });

  it("creates and caches key rotators for a model", () => {
    const rotator1 = service.getRotator("proj-1", "deepseek/deepseek-chat", "sk-key-1, sk-key-2");
    const rotator2 = service.getRotator("proj-1", "deepseek/deepseek-chat");

    expect(rotator1).toBe(rotator2);
    expect(rotator1.totalKeys).toBe(2);
  });

  it("masks keys securely in status reports", () => {
    service.getRotator("proj-1", "deepseek/deepseek-chat", "sk-1234567890abcdef");

    const report = service.getKeyHealth("proj-1", "deepseek/deepseek-chat");
    expect(report.modelRef).toBe("proj-1/deepseek/deepseek-chat");
    expect(report.keys).toHaveLength(1);
    expect(report.keys[0]?.maskedKey).toBe("sk-...cdef");
    expect(report.keys[0]?.status).toBe("healthy");
    expect(report.keys[0]?.isFailed).toBe(false);
  });

  it("tracks cooldown and eviction in health report", () => {
    const rotator = service.getRotator(
      "proj-1",
      "deepseek/deepseek-chat",
      "sk-proj-key-1, sk-proj-key-2",
    );

    rotator.markRateLimited("sk-proj-key-1", 30_000);
    rotator.markFailed("sk-proj-key-2");

    const report = service.getKeyHealth("proj-1", "deepseek/deepseek-chat");
    const key1 = report.keys.find((k) => k.maskedKey.endsWith("ey-1"));
    const key2 = report.keys.find((k) => k.maskedKey.endsWith("ey-2"));

    expect(key1?.status).toBe("cooldown");
    expect(key1?.cooldownRemainingMs).toBeGreaterThan(0);
    expect(key2?.status).toBe("evicted");
    expect(key2?.isFailed).toBe(true);
  });

  it("isolates rotators and health status across different projects", () => {
    const r1 = service.getRotator("proj-alpha", "openai/gpt-4o", "sk-key-1");
    const r2 = service.getRotator("proj-beta", "openai/gpt-4o", "sk-key-1");
    expect(r1).not.toBe(r2);

    r1.markFailed("sk-key-1");
    expect(service.getKeyHealth("proj-alpha", "openai/gpt-4o").evictedCount).toBe(1);
    expect(service.getKeyHealth("proj-beta", "openai/gpt-4o").evictedCount).toBe(0);
  });

  it("resets key health on demand", () => {
    const rotator = service.getRotator(
      "proj-1",
      "deepseek/deepseek-chat",
      "sk-proj-key-1, sk-proj-key-2",
    );

    rotator.markRateLimited("sk-proj-key-1", 60_000);
    rotator.markFailed("sk-proj-key-2");

    service.resetKeyHealth("proj-1", "deepseek/deepseek-chat");

    const report = service.getKeyHealth("proj-1", "deepseek/deepseek-chat");
    expect(report.keys.every((k) => k.status === "healthy")).toBe(true);
    expect(report.keys.every((k) => !k.isFailed)).toBe(true);
  });
});
