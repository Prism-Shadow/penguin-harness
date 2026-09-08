import { describe, expect, it } from "vitest";
import {
  fallbackSemanticId,
  sanitizeSuggestedId,
  uniqueSemanticId,
} from "../src/organization/semantic-id.js";

describe("fallbackSemanticId", () => {
  it("lowercases, folds diacritics and joins words with underscores", () => {
    expect(fallbackSemanticId("Plugin Marketplace", "org")).toBe("plugin_marketplace");
    expect(fallbackSemanticId("  Café--Site!! ", "channel")).toBe("cafe_site");
  });

  it("prefixes a name that starts with a digit so the id starts with a letter", () => {
    expect(fallbackSemanticId("2026 plan", "org")).toBe("org_2026_plan");
    expect(fallbackSemanticId("3d", "channel")).toBe("channel_3d");
  });

  it("pads a one-character name to the two-character minimum", () => {
    expect(fallbackSemanticId("x", "org")).toBe("org_x");
  });

  it("yields null for a name with no ASCII letters or digits", () => {
    expect(fallbackSemanticId("科研公司", "org")).toBeNull();
    expect(fallbackSemanticId("   ", "org")).toBeNull();
    expect(fallbackSemanticId("!!!", "channel")).toBeNull();
  });

  it("keeps the ASCII part of a mixed name", () => {
    expect(fallbackSemanticId("科研 Lab 2", "org")).toBe("lab_2");
  });

  it("caps the length at 64 and never ends in an underscore", () => {
    const id = fallbackSemanticId("a".repeat(60) + " tail words", "org");
    expect(id).toHaveLength(64);
    expect(id?.endsWith("_")).toBe(false);
  });

  it("avoids taken ids with a numeric suffix", () => {
    expect(fallbackSemanticId("Site", "channel", ["site"])).toBe("site_2");
    expect(fallbackSemanticId("Site", "channel", ["site", "site_2"])).toBe("site_3");
  });
});

describe("uniqueSemanticId", () => {
  it("keeps the suffix inside the length cap", () => {
    const base = "b".repeat(64);
    expect(uniqueSemanticId(base, [base])).toBe("b".repeat(62) + "_2");
  });
});

describe("sanitizeSuggestedId", () => {
  it("takes the first non-empty line and strips quotes and code marks", () => {
    expect(sanitizeSuggestedId("\n`research_lab`\n", "org")).toBe("research_lab");
    expect(sanitizeSuggestedId('"Research Lab".', "org")).toBe("research_lab");
  });

  it("returns null for an answer that carries no ASCII", () => {
    expect(sanitizeSuggestedId("科研实验室", "org")).toBeNull();
  });
});
