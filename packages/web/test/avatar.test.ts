/**
 * Letter-avatar helper unit tests: hue/color determinism and spread across
 * names, and initial extraction — code-point based (CJK/emoji stay whole),
 * uppercasing, and the empty/whitespace → fallback → "?" chain.
 */
import { describe, expect, it } from "vitest";
import { avatarColor, avatarHue, avatarInitial } from "../src/lib/avatar";

describe("avatarHue / avatarColor", () => {
  it("is deterministic for the same key", () => {
    expect(avatarHue("my-provider")).toBe(avatarHue("my-provider"));
    expect(avatarColor("agent-1")).toBe(avatarColor("agent-1"));
  });

  it("stays inside the 0-359 hue range", () => {
    for (const key of ["", "a", "my-provider", "深度求索", "🐧"]) {
      const hue = avatarHue(key);
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("spreads distinct hues across realistic group names", () => {
    const names = ["my-llm", "local-vllm", "team-proxy", "backup"];
    expect(new Set(names.map(avatarHue)).size).toBe(names.length);
  });

  it("formats a solid HSL color embedding the key's hue", () => {
    expect(avatarColor("x")).toBe(`hsl(${avatarHue("x")} 52% 46%)`);
  });
});

describe("avatarInitial", () => {
  it("takes the first character, uppercased", () => {
    expect(avatarInitial("my-provider")).toBe("M");
    expect(avatarInitial("Zeta")).toBe("Z");
  });

  it("keeps case-less characters (CJK) as-is", () => {
    expect(avatarInitial("深度求索")).toBe("深");
  });

  it("treats a surrogate-pair character as one initial", () => {
    expect(avatarInitial("🐧 harness")).toBe("🐧");
  });

  it("trims whitespace before picking the initial", () => {
    expect(avatarInitial("  agent")).toBe("A");
  });

  it("falls back to the fallback's initial, then ?", () => {
    expect(avatarInitial("", "agent-1")).toBe("A");
    expect(avatarInitial("   ", " x")).toBe("X");
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial("  ", "  ")).toBe("?");
  });
});
