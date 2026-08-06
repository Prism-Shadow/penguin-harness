/**
 * model-group-expansion.ts unit tests: the models page's default-collapsed vendor groups.
 * Only DeepSeek (the catalog's first provider) is expanded on first paint; the state is a
 * set of EXPANDED ids so groups arriving late (user-defined groups load with the rows)
 * default to collapsed without being known up front. While a search query is active every
 * rendered group is force-opened — groupModelRows only returns match-holding groups when
 * searching, and a match hidden inside a collapsed group would look like a missing result —
 * without touching the stored set.
 */
import { describe, expect, it } from "vitest";
import { MODEL_PROVIDERS } from "@prismshadow/penguin-core/model-catalog";
import {
  defaultExpandedProviders,
  isGroupExpanded,
  toggleExpandedProvider,
} from "../src/features/models/model-group-expansion";
import { groupModelRows } from "../src/features/models/model-grouping";
import type { ModelRowLike } from "../src/features/models/model-grouping";

describe("defaultExpandedProviders", () => {
  it("contains exactly deepseek, the first provider of the catalog", () => {
    expect([...defaultExpandedProviders()]).toEqual(["deepseek"]);
    // The default leans on the catalog ordering promise (DeepSeek first): pin it here so a
    // reordering shows up as this failure instead of a silently odd default.
    expect(MODEL_PROVIDERS[0]?.id).toBe("deepseek");
  });

  it("returns a fresh set per call (React state must not share one mutable instance)", () => {
    const a = defaultExpandedProviders();
    const b = defaultExpandedProviders();
    expect(a).not.toBe(b);
    a.add("openai");
    expect(b.has("openai")).toBe(false);
  });
});

describe("isGroupExpanded", () => {
  const expanded = defaultExpandedProviders();

  it("without a search query, only members of the expanded set are open", () => {
    expect(isGroupExpanded(expanded, "deepseek", false)).toBe(true);
    expect(isGroupExpanded(expanded, "anthropic", false)).toBe(false);
    expect(isGroupExpanded(expanded, "custom", false)).toBe(false);
    // User-defined groups are decided by the same membership rule — collapsed until toggled.
    expect(isGroupExpanded(expanded, "my-proxy", false)).toBe(false);
  });

  it("while searching, every group is open regardless of the stored set", () => {
    expect(isGroupExpanded(expanded, "anthropic", true)).toBe(true);
    expect(isGroupExpanded(new Set(), "deepseek", true)).toBe(true);
  });

  it("force-open covers each group a search actually renders (the hidden-results regression)", () => {
    const rows: ModelRowLike[] = [
      { provider: "deepseek", modelId: "deepseek-chat" },
      { provider: "anthropic", modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
      { provider: "moonshot", modelId: "kimi-k2.6", displayName: "Kimi K2.6" },
      { provider: "my-proxy", modelId: "kimi-mirror" },
    ];
    // "kimi" matches inside groups that default to collapsed (moonshot + a user-defined one):
    // with the query active each rendered group must derive as open.
    const groups = groupModelRows(rows, "kimi");
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(isGroupExpanded(defaultExpandedProviders(), g.provider.id, true)).toBe(true);
    }
    // Clearing the query falls back to the stored set: the same groups collapse again.
    for (const g of groups) {
      expect(isGroupExpanded(defaultExpandedProviders(), g.provider.id, false)).toBe(
        g.provider.id === "deepseek",
      );
    }
  });
});

describe("toggleExpandedProvider", () => {
  it("adds an absent id and removes a present one, without mutating the input", () => {
    const initial = defaultExpandedProviders();
    const withAnthropic = toggleExpandedProvider(initial, "anthropic");
    expect(withAnthropic.has("anthropic")).toBe(true);
    expect(withAnthropic.has("deepseek")).toBe(true);
    expect(initial.has("anthropic")).toBe(false); // input untouched (React state discipline)

    const withoutDeepseek = toggleExpandedProvider(withAnthropic, "deepseek");
    expect(withoutDeepseek.has("deepseek")).toBe(false);
    expect(withoutDeepseek.has("anthropic")).toBe(true);
    expect(withAnthropic.has("deepseek")).toBe(true);
  });
});
