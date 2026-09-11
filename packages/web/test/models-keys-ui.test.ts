import { describe, expect, it } from "vitest";
import {
  formatCooldown,
  keyHealthLabel,
  keyHealthTone,
  parseMultiKeys,
} from "../src/features/models/model-keys-health";

describe("model-keys-health", () => {
  describe("keyHealthTone", () => {
    it("maps healthy status to success tone (emerald)", () => {
      expect(keyHealthTone("healthy")).toBe("success");
    });

    it("maps cooldown status to attention tone (amber)", () => {
      expect(keyHealthTone("cooldown")).toBe("attention");
    });

    it("maps evicted status to danger tone (red)", () => {
      expect(keyHealthTone("evicted")).toBe("danger");
    });
  });

  describe("formatCooldown", () => {
    it("returns empty string when cooldown has expired or is zero", () => {
      expect(formatCooldown(0)).toBe("");
      expect(formatCooldown(-500)).toBe("");
    });

    it("formats seconds under one minute", () => {
      expect(formatCooldown(30_000)).toBe("30s");
      expect(formatCooldown(59_400)).toBe("60s");
      expect(formatCooldown(1_500)).toBe("2s");
    });

    it("formats minutes when over 60 seconds", () => {
      expect(formatCooldown(65_000)).toBe("2m");
      expect(formatCooldown(120_000)).toBe("2m");
      expect(formatCooldown(300_000)).toBe("5m");
    });
  });

  describe("keyHealthLabel", () => {
    it("formats active healthy keys", () => {
      expect(
        keyHealthLabel({
          maskedKey: "sk-...1234",
          status: "healthy",
          isFailed: false,
          cooldownRemainingMs: 0,
          successCount: 5,
          failureCount: 0,
        }),
      ).toBe("Active");
    });

    it("formats cooling down keys with remaining time", () => {
      expect(
        keyHealthLabel({
          maskedKey: "sk-...1234",
          status: "cooldown",
          isFailed: false,
          cooldownRemainingMs: 45_000,
          successCount: 1,
          failureCount: 1,
        }),
      ).toBe("Cooldown (45s)");
    });

    it("formats evicted keys with 401 note", () => {
      expect(
        keyHealthLabel({
          maskedKey: "sk-...1234",
          status: "evicted",
          isFailed: true,
          cooldownRemainingMs: 0,
          successCount: 0,
          failureCount: 1,
        }),
      ).toBe("Evicted (401)");
    });
  });

  describe("parseMultiKeys", () => {
    it("extracts multiple keys delimited by commas or newlines", () => {
      const input = `sk-key-1, sk-key-2
sk-key-3;sk-key-4`;
      const keys = parseMultiKeys(input);
      expect(keys).toEqual(["sk-key-1", "sk-key-2", "sk-key-3", "sk-key-4"]);
    });

    it("deduplicates keys and trims whitespace", () => {
      const input = "  sk-key-1  ,  sk-key-2  ,  sk-key-1  ";
      const keys = parseMultiKeys(input);
      expect(keys).toEqual(["sk-key-1", "sk-key-2"]);
    });

    it("handles empty or blank input", () => {
      expect(parseMultiKeys("")).toEqual([]);
      expect(parseMultiKeys("   \n\n  ,  ")).toEqual([]);
    });
  });
});
