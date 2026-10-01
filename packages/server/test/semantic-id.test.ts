/**
 * Semantic ids (services/semantic-id.ts): how a create dialog's name becomes the id of an
 * organization, a channel, a Project, an Agent or a Benchmark, when the model is not asked or
 * its answer is unusable.
 *
 * - A name folds to a lowercase id behind the kind's prefix: diacritics folded, words joined,
 *   the prefix never doubled; a name with no ASCII letter or digit yields nothing; the ASCII
 *   part of a mixed name is kept.
 * - An id is capped at 64 characters with its prefix kept, never ending in a separator, and a
 *   taken id gets a numeric suffix (compared after prefixing) that stays inside the cap.
 * - A model's answer is read from its first non-empty line, quotes and code marks stripped,
 *   prefixed once; an answer with no ASCII yields nothing.
 * - A placeholder is a valid, dated, obviously temporary id that avoids the taken ones.
 * - Projects and Agents take a bare snake_case id, repaired behind the noun when it would start
 *   with a digit or be one letter; a Benchmark takes a kebab-case id; a non-admin's Project
 *   lives in the owner's namespace; every kind accepts its own placeholder.
 */
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

const { org, channel } = SEMANTIC_ID_RULES;

describe("fallbackSemanticId", () => {
  it("folds a name to a lowercase id behind the kind's prefix", () => {
    const cases = [
      ["Plugin Marketplace", org, "co_plugin_marketplace"],
      // Diacritics fold, and punctuation runs collapse to one separator.
      ["  Café--Site!! ", channel, "ch_cafe_site"],
      // The prefix is what makes a name starting with a digit a valid id…
      ["2026 plan", org, "co_2026_plan"],
      ["3d", channel, "ch_3d"],
      // …and what makes a one-character name long enough.
      ["x", org, "co_x"],
      // A core that already carries the prefix is not prefixed twice.
      ["co_acme", org, "co_acme"],
      ["Ch Site", channel, "ch_site"],
      // The ASCII part of a mixed name is kept.
      ["科研 Lab 2", org, "co_lab_2"],
    ] as const;
    for (const [name, rule, id] of cases) expect(fallbackSemanticId(name, rule), name).toBe(id);
  });

  it("yields nothing for a name with no ASCII letters or digits", () => {
    for (const name of ["科研公司", "   ", "!!!"]) {
      expect(fallbackSemanticId(name, org), name).toBeNull();
    }
  });

  it("caps the length at 64 with the prefix kept, and never ends in an underscore", () => {
    expect(fallbackSemanticId("a".repeat(70) + " tail words", org)).toBe(`co_${"a".repeat(61)}`);
  });

  it("avoids taken ids with a numeric suffix, compared after prefixing", () => {
    expect(fallbackSemanticId("Site", channel, ["ch_site"])).toBe("ch_site_2");
    expect(fallbackSemanticId("Site", channel, ["ch_site", "ch_site_2"])).toBe("ch_site_3");
    // The bare core is not the id, so holding it takes nothing.
    expect(fallbackSemanticId("Site", channel, ["site"])).toBe("ch_site");
    // The suffix stays inside the length cap.
    expect(uniqueSemanticId("b".repeat(64), ["b".repeat(64)], "_", 64)).toBe("b".repeat(62) + "_2");
  });
});

describe("prefixSemanticId", () => {
  it("puts the kind's prefix in front exactly once", () => {
    expect(prefixSemanticId("marketing", channel)).toBe("ch_marketing");
    expect(prefixSemanticId("ch_marketing", channel)).toBe("ch_marketing");
    expect(prefixSemanticId("marketing", org)).toBe("co_marketing");
  });
});

describe("sanitizeSuggestedId", () => {
  it("reads the first non-empty line, strips quotes and code marks, and prefixes it once", () => {
    expect(sanitizeSuggestedId("\n`research_lab`\n", org)).toBe("co_research_lab");
    expect(sanitizeSuggestedId('"Research Lab".', org)).toBe("co_research_lab");
    expect(sanitizeSuggestedId("co_research_lab", org)).toBe("co_research_lab");
    // An answer with no ASCII names nothing.
    expect(sanitizeSuggestedId("科研实验室", org)).toBeNull();
  });
});

describe("placeholderSemanticId", () => {
  const day = new Date(2026, 8, 9); // 2026-09-09, local — the stamp is the host's own date.

  it("is a valid, dated, obviously-temporary id, prefixed by kind, with a padded date", () => {
    expect(placeholderSemanticId(org, [], day)).toBe("co_org_20260909");
    expect(placeholderSemanticId(channel, [], day)).toBe("ch_channel_20260909");
    expect(placeholderSemanticId(org, [], new Date(2026, 0, 3))).toBe("co_org_20260103");
  });

  it("avoids the ids already taken, so pressing the button twice gives two ids", () => {
    expect(placeholderSemanticId(org, ["co_org_20260909"], day)).toBe("co_org_20260909_2");
    expect(placeholderSemanticId(org, ["co_org_20260909", "co_org_20260909_2"], day)).toBe(
      "co_org_20260909_3",
    );
  });
});

describe("the kind table", () => {
  const day = new Date(2026, 8, 9);
  const alice = projectIdRule({ userId: "alice", isAdmin: false });

  it("gives Projects and Agents a bare snake_case id, repaired behind the noun when it would start with a digit or be one letter", () => {
    expect(fallbackSemanticId("Plugin Marketplace", SEMANTIC_ID_RULES.project)).toBe(
      "plugin_marketplace",
    );
    expect(fallbackSemanticId("Report Writer", SEMANTIC_ID_RULES.agent)).toBe("report_writer");
    expect(fallbackSemanticId("3D Viewer", SEMANTIC_ID_RULES.agent)).toBe("agent_3d_viewer");
    expect(fallbackSemanticId("x", SEMANTIC_ID_RULES.agent)).toBe("agent_x");
    expect(fallbackSemanticId("2026 Plan", SEMANTIC_ID_RULES.project)).toBe("project_2026_plan");
    expect(fallbackSemanticId("报告写手", SEMANTIC_ID_RULES.agent)).toBeNull();
    for (const kind of ["project", "agent"] as const) {
      expect(SEMANTIC_ID_RULES[kind].accepts("report_writer")).toBe(true);
      expect(SEMANTIC_ID_RULES[kind].accepts("2026_plan")).toBe(false);
    }
  });

  it("gives a Benchmark a kebab-case id, suffixed with a hyphen", () => {
    expect(fallbackSemanticId("Report Writing (hard) v1", SEMANTIC_ID_RULES.benchmark)).toBe(
      "report-writing-hard-v1",
    );
    // A model that answers in snake_case is folded into the kind's spelling.
    expect(sanitizeSuggestedId("`report_writing`", SEMANTIC_ID_RULES.benchmark)).toBe(
      "report-writing",
    );
    // Nothing to repair: a Benchmark id may start with a digit.
    expect(fallbackSemanticId("2026 eval", SEMANTIC_ID_RULES.benchmark)).toBe("2026-eval");
    expect(
      fallbackSemanticId("Report Writing", SEMANTIC_ID_RULES.benchmark, ["report-writing"]),
    ).toBe("report-writing-2");
    expect(uniqueSemanticId("a".repeat(64), ["a".repeat(64)], "-", 64)).toBe(`${"a".repeat(62)}-2`);
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
    expect(placeholderSemanticId(SEMANTIC_ID_RULES.project, [], day)).toBe("project_20260909");
    expect(placeholderSemanticId(alice, [], day)).toBe("alice-project_20260909");
    expect(placeholderSemanticId(SEMANTIC_ID_RULES.agent, ["agent_20260909"], day)).toBe(
      "agent_20260909_2",
    );
    expect(placeholderSemanticId(SEMANTIC_ID_RULES.benchmark, ["benchmark-20260909"], day)).toBe(
      "benchmark-20260909-2",
    );
    for (const kind of ["org", "channel", "project", "agent", "benchmark"] as const) {
      expect(
        SEMANTIC_ID_RULES[kind].accepts(placeholderSemanticId(SEMANTIC_ID_RULES[kind], [], day)),
        kind,
      ).toBe(true);
    }
  });
});
