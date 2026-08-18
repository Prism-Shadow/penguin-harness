import { describe, expect, it } from "vitest";
import { searchToolCatalog } from "../src/environment/tool-catalog.js";

const catalog = [
  {
    definition: {
      name: "mcp__github__create_issue",
      description: "Create an issue in a repository.",
      parameters: {
        type: "object",
        properties: { repository: { type: "string" }, title: { type: "string" } },
      },
    },
    metadata: { permission: "rw" },
    aliases: ["github", "create_issue"],
  },
  {
    definition: {
      name: "mcp__github__search_issues",
      description: "Search repository issues and pull requests.",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
    metadata: { permission: "r" },
    aliases: ["github", "search_issues"],
  },
  {
    definition: {
      name: "mcp__slack__search",
      description: "Find messages in Slack.",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
    metadata: { permission: "r" },
    aliases: ["slack", "search"],
  },
] as const;

describe("searchToolCatalog", () => {
  it("ranks exact aliases and tool names ahead of broad description matches", () => {
    const matches = searchToolCatalog(catalog, "search_issues", 3);
    expect(matches[0]?.definition.name).toBe("mcp__github__search_issues");
    expect(matches[0]!.score).toBeGreaterThan(matches[1]!.score);
  });

  it("treats snake-case and kebab-case names as natural-language terms", () => {
    const [match] = searchToolCatalog(catalog, "find github search issues", 1);
    expect(match?.definition.name).toBe("mcp__github__search_issues");
    expect(match?.score).toBeGreaterThanOrEqual(300);
  });

  it("searches descriptions and parameter names while preserving stable ties", () => {
    expect(searchToolCatalog(catalog, "repository", 3).map((m) => m.definition.name)).toEqual([
      "mcp__github__create_issue",
      "mcp__github__search_issues",
    ]);
    expect(searchToolCatalog(catalog, "query", 1)[0]?.definition.name).toBe(
      "mcp__github__search_issues",
    );
  });

  it("does not return arbitrary tools for an empty query and respects the limit", () => {
    expect(searchToolCatalog(catalog, "", 10)).toEqual([]);
    expect(searchToolCatalog(catalog, "search", 1)).toHaveLength(1);
  });

  it("ignores transport words that cannot distinguish catalog entries", () => {
    expect(searchToolCatalog(catalog, "MCP tool capability", 10)).toEqual([]);
  });

  it("does not let date numbers and short connective words dominate name terms", () => {
    const withNumber = [
      ...catalog,
      {
        definition: {
          name: "mcp__generic__operation_20",
          description: "Perform an unrelated remote operation.",
          parameters: {},
        },
        metadata: { permission: "r" },
        aliases: ["generic", "operation_20"],
      },
    ];
    const matches = searchToolCatalog(withNumber, "find a github issue before 2026-08-20", 4);
    expect(matches[0]?.definition.name).toMatch(/^mcp__github__/u);
    expect(matches.find((match) => match.definition.name.endsWith("operation_20"))).toBeUndefined();
  });
});
