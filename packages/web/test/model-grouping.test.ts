/**
 * model-grouping.ts unit tests: search filtering (id / display name / provider name,
 * case-insensitive) and grouping by provider — grouping reads the row's **provider field**
 * directly ((provider, model_id) are stored as separate columns; id is never concatenated
 * or split anywhere); built-in group order follows MODEL_PROVIDERS with custom last, and any
 * provider not in the catalog becomes a custom-built group — each forms its own
 * group, sorted by name and appended after custom; empty groups are hidden, except the
 * custom group, which is always shown when there's no search query, hosting the generic
 * "add model" entry point.
 */
import { describe, expect, it } from "vitest";
import { MODEL_PROVIDERS } from "@prismshadow/penguin-core/model-catalog";
import {
  groupModelRows,
  orderModelsLikeLibrary,
  matchesQuery,
} from "../src/features/models/model-grouping";
import type { ModelRowLike } from "../src/features/models/model-grouping";

const rows: ModelRowLike[] = [
  { provider: "anthropic", modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
  { provider: "anthropic", modelId: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
  { provider: "moonshot", modelId: "kimi-k2.6", displayName: "Kimi K2.6" },
  { provider: "custom", modelId: "my-proxy-model" },
  { provider: "unknown-vendor", modelId: "weird-model" }, // provider not in the catalog → custom-built group
];

describe("matchesQuery", () => {
  it("an empty query is always true", () => {
    expect(matchesQuery(rows[0]!, "")).toBe(true);
    expect(matchesQuery(rows[0]!, "   ")).toBe(true);
  });

  it("matches by model_id / display name / provider name, case-insensitive", () => {
    expect(matchesQuery(rows[0]!, "SONNET")).toBe(true); // display name
    expect(matchesQuery(rows[0]!, "claude-sonnet")).toBe(true); // upstream id
    expect(matchesQuery(rows[0]!, "anthropic")).toBe(true); // provider
    expect(matchesQuery(rows[2]!, "moonshot")).toBe(true); // provider label includes Moonshot (Kimi)
    expect(matchesQuery(rows[0]!, "gemini")).toBe(false);
  });

  it("custom models without a display name match by id and the Custom group name", () => {
    expect(matchesQuery(rows[3]!, "proxy")).toBe(true);
    expect(matchesQuery(rows[3]!, "custom")).toBe(true);
    // Custom-built groups are searchable by their group name (raw provider value); no longer folded into the Custom bucket.
    expect(matchesQuery(rows[4]!, "unknown-vendor")).toBe(true);
    expect(matchesQuery(rows[4]!, "custom")).toBe(false);
  });
});

describe("groupModelRows", () => {
  it("groups by the row's provider (order follows MODEL_PROVIDERS), custom last, custom-built groups appended after", () => {
    const groups = groupModelRows(rows, "");
    expect(groups.map((g) => g.provider.id)).toEqual([
      "anthropic",
      "moonshot",
      "custom",
      "unknown-vendor",
    ]);
    expect(groups[0]!.rows.map((r) => r.modelId)).toEqual(["claude-sonnet-4-6", "claude-opus-4-8"]);
    expect(groups[2]!.rows.map((r) => r.modelId)).toEqual(["my-proxy-model"]);
    // Custom-built group: synthesized provider info — label is the group name, OpenAI-protocol semantics (env falls back to OPENAI_*).
    expect(groups[3]!.provider.label).toBe("unknown-vendor");
    expect(groups[3]!.provider.envKey).toBe("OPENAI_API_KEY");
    expect(groups[3]!.rows.map((r) => r.modelId)).toEqual(["weird-model"]);
    // Group order matches the MODEL_PROVIDERS definition: DeepSeek first, the two gateways right after,
    // Google Gemini before Anthropic, custom last.
    expect(MODEL_PROVIDERS.map((p) => p.id)).toEqual([
      "deepseek",
      "openrouter",
      "fireworks",
      "siliconflow",
      "qwen-token-plan",
      "qwen-pay-as-you-go",
      "google",
      "anthropic",
      "openai",
      "zhipu",
      "moonshot",
      "custom",
    ]);
    expect(MODEL_PROVIDERS.find((p) => p.id === "siliconflow")!.label).toBe("SiliconFlow");
  });

  it("the custom group always shows without a search query (returned even when empty, hosting the add entry point)", () => {
    const vendorOnly: ModelRowLike[] = [{ provider: "moonshot", modelId: "kimi-k2.6" }];
    const groups = groupModelRows(vendorOnly, "");
    expect(groups.map((g) => g.provider.id)).toEqual(["moonshot", "custom"]);
    expect(groups[1]!.rows).toEqual([]);
    // Empty groups for other providers stay hidden (only moonshot and custom appear above).
    // With a search query, the empty custom group no longer appears.
    expect(groupModelRows(vendorOnly, "kimi").map((g) => g.provider.id)).toEqual(["moonshot"]);
  });

  it("searching keeps only matching rows; empty groups are not returned", () => {
    const groups = groupModelRows(rows, "kimi");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.provider.id).toBe("moonshot");
    expect(groups[0]!.rows.map((r) => r.modelId)).toEqual(["kimi-k2.6"]);
    expect(groupModelRows(rows, "no-such-model")).toEqual([]);
  });

  it("a `/` inside the upstream id (gateway models) is just a character: grouping reads only the provider field", () => {
    const gateway: ModelRowLike[] = [{ provider: "openrouter", modelId: "xiaomi/mimo-v2.5" }];
    const groups = groupModelRows(gateway, "");
    expect(groups.map((g) => g.provider.id)).toEqual(["openrouter", "custom"]);
    expect(groups[0]!.rows[0]!.modelId).toBe("xiaomi/mimo-v2.5");
    expect(matchesQuery(gateway[0]!, "mimo")).toBe(true);
  });

  it("the same model_id under different providers coexists: each in its own group, never merged", () => {
    const dup: ModelRowLike[] = [
      { provider: "moonshot", modelId: "kimi-k2.6" },
      { provider: "siliconflow", modelId: "kimi-k2.6" },
    ];
    const groups = groupModelRows(dup, "");
    expect(groups.map((g) => g.provider.id)).toEqual(["siliconflow", "moonshot", "custom"]);
    expect(groups[0]!.rows).toHaveLength(1);
    expect(groups[1]!.rows).toHaveLength(1);
  });

  it("multiple custom-built groups sort by name and append after custom", () => {
    const mixed: ModelRowLike[] = [
      { provider: "zeta-lab", modelId: "z-1" },
      { provider: "alpha-proxy", modelId: "a-1" },
    ];
    const groups = groupModelRows(mixed, "");
    expect(groups.map((g) => g.provider.id)).toEqual(["custom", "alpha-proxy", "zeta-lab"]);
    // Search matches a custom-built group's name: only that group is kept.
    expect(groupModelRows(mixed, "zeta").map((g) => g.provider.id)).toEqual(["zeta-lab"]);
  });
});

describe("orderModelsLikeLibrary", () => {
  it("flattens to the library page's order: built-in provider order, user groups after, custom last", () => {
    const rows: ModelRowLike[] = [
      { provider: "custom", modelId: "my-proxy" },
      { provider: "my-gateway", modelId: "own-1" },
      { provider: "moonshot", modelId: "kimi-k3" },
      { provider: "deepseek", modelId: "deepseek-v4-flash" },
      { provider: "openrouter", modelId: "anthropic/claude-fable-5" },
      { provider: "deepseek", modelId: "deepseek-v4-pro" },
    ];
    expect(orderModelsLikeLibrary(rows).map((r) => `${r.provider} ${r.modelId}`)).toEqual([
      // deepseek first (in-group order preserved), then the openrouter gateway, then moonshot,
      // then custom, then the user-defined group appended after the built-ins.
      "deepseek deepseek-v4-flash",
      "deepseek deepseek-v4-pro",
      "openrouter anthropic/claude-fable-5",
      "moonshot kimi-k3",
      "custom my-proxy",
      "my-gateway own-1",
    ]);
  });
});
