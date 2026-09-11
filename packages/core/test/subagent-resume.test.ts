import { describe, it, expect } from "vitest";
import { ApiKeyRotator } from "../src/llm/key-rotator.js";

describe("Subagent resumability and key lease rotation", () => {
  it("tracks and releases subagent key leases correctly", () => {
    const keys = ["sk-key-1", "sk-key-2", "sk-key-3"];
    const rotator = new ApiKeyRotator(keys);

    const { rotator: sub1, release: release1 } = rotator.allocateSubagentRotator("least_busy");
    const selected1 = sub1.currentKey();
    expect(selected1).toBe("sk-key-1");
    expect(rotator.activeLeases).toBe(1);

    const { rotator: sub2, release: release2 } = rotator.allocateSubagentRotator("least_busy");
    const selected2 = sub2.currentKey();
    expect(selected2).toBe("sk-key-2");
    expect(rotator.activeLeases).toBe(2);

    release1();
    expect(rotator.activeLeases).toBe(1);

    release2();
    expect(rotator.activeLeases).toBe(0);
  });

  it("rotates away from cooldown keys during subagent allocation", () => {
    const keys = ["sk-alpha", "sk-beta"];
    const rotator = new ApiKeyRotator(keys, { cooldownMs: 30000 });

    rotator.markRateLimited("sk-alpha");

    const { rotator: subRotator, release } = rotator.allocateSubagentRotator("least_busy");
    expect(subRotator.currentKey()).toBe("sk-beta");
    release();
  });

  it("handles failover to working keys on rate limits in child rotator", () => {
    const keys = ["sk-first", "sk-second"];
    const rotator = new ApiKeyRotator(keys, { cooldownMs: 60000 });

    const { rotator: child, release } = rotator.allocateSubagentRotator("round_robin");
    expect(child.currentKey()).toBe("sk-first");

    child.markRateLimited("sk-first");
    const nextKey = child.nextKey();
    expect(nextKey).toBe("sk-second");

    release();
  });
});
