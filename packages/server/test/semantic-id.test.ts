import { describe, expect, it } from "vitest";
import {
  fallbackSemanticId,
  prefixSemanticId,
  sanitizeSuggestedId,
  uniqueSemanticId,
} from "../src/organization/semantic-id.js";

describe("fallbackSemanticId", () => {
  it("lowercases, folds diacritics, joins words with underscores and prefixes by kind", () => {
    expect(fallbackSemanticId("Plugin Marketplace", "org")).toBe("co_plugin_marketplace");
    expect(fallbackSemanticId("  Café--Site!! ", "channel")).toBe("ch_cafe_site");
  });

  it("the prefix is what makes a name starting with a digit a valid id", () => {
    expect(fallbackSemanticId("2026 plan", "org")).toBe("co_2026_plan");
    expect(fallbackSemanticId("3d", "channel")).toBe("ch_3d");
  });

  it("a one-character name is already long enough once prefixed", () => {
    expect(fallbackSemanticId("x", "org")).toBe("co_x");
  });

  it("does not prefix a core that already carries the prefix", () => {
    expect(fallbackSemanticId("co_acme", "org")).toBe("co_acme");
    expect(fallbackSemanticId("Ch Site", "channel")).toBe("ch_site");
  });

  it("yields null for a name with no ASCII letters or digits", () => {
    expect(fallbackSemanticId("科研公司", "org")).toBeNull();
    expect(fallbackSemanticId("   ", "org")).toBeNull();
    expect(fallbackSemanticId("!!!", "channel")).toBeNull();
  });

  it("keeps the ASCII part of a mixed name", () => {
    expect(fallbackSemanticId("科研 Lab 2", "org")).toBe("co_lab_2");
  });

  it("caps the length at 64 with the prefix kept, and never ends in an underscore", () => {
    expect(fallbackSemanticId("a".repeat(70) + " tail words", "org")).toBe(`co_${"a".repeat(61)}`);
  });

  it("avoids taken ids with a numeric suffix, compared after prefixing", () => {
    expect(fallbackSemanticId("Site", "channel", ["ch_site"])).toBe("ch_site_2");
    expect(fallbackSemanticId("Site", "channel", ["ch_site", "ch_site_2"])).toBe("ch_site_3");
    // The bare core is not the id, so holding it takes nothing.
    expect(fallbackSemanticId("Site", "channel", ["site"])).toBe("ch_site");
  });
});

describe("prefixSemanticId", () => {
  it("puts the kind's prefix in front exactly once", () => {
    expect(prefixSemanticId("marketing", "channel")).toBe("ch_marketing");
    expect(prefixSemanticId("ch_marketing", "channel")).toBe("ch_marketing");
    expect(prefixSemanticId("marketing", "org")).toBe("co_marketing");
  });
});

describe("uniqueSemanticId", () => {
  it("keeps the suffix inside the length cap", () => {
    const base = "b".repeat(64);
    expect(uniqueSemanticId(base, [base])).toBe("b".repeat(62) + "_2");
  });
});

describe("sanitizeSuggestedId", () => {
  it("takes the first non-empty line, strips quotes and code marks, and prefixes it", () => {
    expect(sanitizeSuggestedId("\n`research_lab`\n", "org")).toBe("co_research_lab");
    expect(sanitizeSuggestedId('"Research Lab".', "org")).toBe("co_research_lab");
  });

  it("does not double a prefix the model added itself", () => {
    expect(sanitizeSuggestedId("co_research_lab", "org")).toBe("co_research_lab");
  });

  it("returns null for an answer that carries no ASCII", () => {
    expect(sanitizeSuggestedId("科研实验室", "org")).toBeNull();
  });
});
