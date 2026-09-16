import { describe, expect, it } from "vitest";
import {
  SEMANTIC_ID_RULES,
  fallbackSemanticId,
  placeholderSemanticId,
  prefixSemanticId,
  projectIdRule,
  sanitizeSuggestedId,
  uniqueSemanticId,
} from "../src/services/semantic-id.js";

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

describe("placeholderSemanticId", () => {
  const day = new Date(2026, 8, 9); // 2026-09-09, local — the stamp is the host's own date.

  it("is a valid, dated, obviously-temporary id, prefixed by kind", () => {
    expect(placeholderSemanticId("org", [], day)).toBe("co_org_20260909");
    expect(placeholderSemanticId("channel", [], day)).toBe("ch_channel_20260909");
  });

  it("pads a single-digit month and day", () => {
    expect(placeholderSemanticId("org", [], new Date(2026, 0, 3))).toBe("co_org_20260103");
  });

  it("avoids the ids already taken, so pressing the button twice gives two ids", () => {
    expect(placeholderSemanticId("org", ["co_org_20260909"], day)).toBe("co_org_20260909_2");
    expect(placeholderSemanticId("org", ["co_org_20260909", "co_org_20260909_2"], day)).toBe(
      "co_org_20260909_3",
    );
  });
});

describe("the kind table", () => {
  const day = new Date(2026, 8, 9);
  const alice = projectIdRule({ userId: "alice", isAdmin: false });

  it("gives Projects and Agents a bare snake_case id, repaired behind the noun when it would start with a digit or be one letter", () => {
    expect(fallbackSemanticId("Plugin Marketplace", "project")).toBe("plugin_marketplace");
    expect(fallbackSemanticId("Report Writer", "agent")).toBe("report_writer");
    expect(fallbackSemanticId("3D Viewer", "agent")).toBe("agent_3d_viewer");
    expect(fallbackSemanticId("x", "agent")).toBe("agent_x");
    expect(fallbackSemanticId("2026 Plan", "project")).toBe("project_2026_plan");
    expect(fallbackSemanticId("报告写手", "agent")).toBeNull();
    for (const kind of ["project", "agent"] as const) {
      expect(SEMANTIC_ID_RULES[kind].prefix).toBe("");
      expect(SEMANTIC_ID_RULES[kind].accepts("report_writer")).toBe(true);
      expect(SEMANTIC_ID_RULES[kind].accepts("2026_plan")).toBe(false);
    }
  });

  it("gives a Benchmark a kebab-case id, suffixed with a hyphen", () => {
    expect(fallbackSemanticId("Report Writing (hard) v1", "benchmark")).toBe(
      "report-writing-hard-v1",
    );
    // A model that answers in snake_case is folded into the kind's spelling.
    expect(sanitizeSuggestedId("`report_writing`", "benchmark")).toBe("report-writing");
    // Nothing to repair: a Benchmark id may start with a digit.
    expect(fallbackSemanticId("2026 eval", "benchmark")).toBe("2026-eval");
    expect(fallbackSemanticId("Report Writing", "benchmark", ["report-writing"])).toBe(
      "report-writing-2",
    );
    expect(uniqueSemanticId("a".repeat(64), ["a".repeat(64)], "-")).toBe(`${"a".repeat(62)}-2`);
    expect(SEMANTIC_ID_RULES.benchmark.accepts("Report_writing-v1")).toBe(true);
    expect(SEMANTIC_ID_RULES.benchmark.accepts("../escape")).toBe(false);
  });

  it("puts a non-admin's Project in the owner's namespace, and leaves the admin's bare", () => {
    expect(projectIdRule({ userId: "root", isAdmin: true })).toBe(SEMANTIC_ID_RULES.project);
    expect(fallbackSemanticId("Research Lab", alice)).toBe("alice-research_lab");
    // The suffix may start with a digit: the namespace already starts the id with a letter.
    expect(fallbackSemanticId("2026 Plan", alice)).toBe("alice-2026_plan");
    expect(sanitizeSuggestedId("research_lab", alice, ["alice-research_lab"])).toBe(
      "alice-research_lab_2",
    );
    // The whole id stays within the Project id's cap, namespace included.
    const long = fallbackSemanticId("word ".repeat(30), alice);
    expect(long?.startsWith("alice-")).toBe(true);
    expect(long?.length).toBeLessThanOrEqual(64);
    expect(alice.accepts(long!)).toBe(true);
    expect(alice.accepts("bob-research_lab")).toBe(false);
    expect(alice.accepts("research_lab")).toBe(false);
  });

  it("dates a placeholder behind every kind's own noun and prefix", () => {
    expect(placeholderSemanticId("project", [], day)).toBe("project_20260909");
    expect(placeholderSemanticId(alice, [], day)).toBe("alice-project_20260909");
    expect(placeholderSemanticId("agent", ["agent_20260909"], day)).toBe("agent_20260909_2");
    expect(placeholderSemanticId("benchmark", ["benchmark-20260909"], day)).toBe(
      "benchmark-20260909-2",
    );
    for (const kind of ["org", "channel", "project", "agent", "benchmark"] as const) {
      expect(SEMANTIC_ID_RULES[kind].accepts(placeholderSemanticId(kind, [], day)), kind).toBe(
        true,
      );
    }
  });
});
