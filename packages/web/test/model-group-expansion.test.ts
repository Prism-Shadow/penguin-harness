/** The model library stores manual group choices per Project. Search reveals matches temporarily. */
import { describe, expect, it } from "vitest";
import { MODEL_PROVIDERS } from "@prismshadow/penguin-server/model-catalog";
import {
  defaultExpandedProviders,
  expandedGroupsKey,
  isGroupExpanded,
  loadExpandedProviders,
  saveExpandedProviders,
  toggleExpandedProvider,
  type ExpansionStorage,
} from "@prismshadow/penguin-library-model/web/models/model-group-expansion";

import { groupModelRows, type ModelRowLike } from "../src/lib/model-grouping";

/** In-memory storage (vitest runs in a Node environment, no localStorage; draft-cache.test.ts convention). */
function memStorage(): ExpansionStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

/** Exercise the real first provider, including when catalog ordering changes. */
const LEAD_GROUP = MODEL_PROVIDERS[0]!.id;

describe("defaultExpandedProviders", () => {
  it("starts with no expanded provider", () => {
    expect([...defaultExpandedProviders()]).toEqual([]);
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
    expect(isGroupExpanded(expanded, LEAD_GROUP, false)).toBe(false);
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
      expect(isGroupExpanded(defaultExpandedProviders(), g.provider.id, false)).toBe(false);
    }
  });
});

describe("toggleExpandedProvider", () => {
  it("adds an absent id and removes a present one, without mutating the input", () => {
    const initial = new Set([LEAD_GROUP]);
    const withAnthropic = toggleExpandedProvider(initial, "anthropic");
    expect(withAnthropic.has("anthropic")).toBe(true);
    expect(withAnthropic.has(LEAD_GROUP)).toBe(true);
    expect(initial.has("anthropic")).toBe(false); // input untouched (React state discipline)

    const withoutLead = toggleExpandedProvider(withAnthropic, LEAD_GROUP);
    expect(withoutLead.has(LEAD_GROUP)).toBe(false);
    expect(withoutLead.has("anthropic")).toBe(true);
    expect(withAnthropic.has(LEAD_GROUP)).toBe(true);
  });
});

describe("persisted expansion (per-Project localStorage)", () => {
  it("nothing stored or no Project yet leaves all groups collapsed", () => {
    const s = memStorage();
    expect([...loadExpandedProviders("p1", s)]).toEqual([]);
    expect([...loadExpandedProviders(null, s)]).toEqual([]);
    expect(s.map.size).toBe(0); // load never writes; save without a Project is a no-op
    saveExpandedProviders(null, new Set(["openai"]), s);
    expect(s.map.size).toBe(0);
  });

  it("toggle → save → load round-trips the user's set", () => {
    const s = memStorage();
    let set = loadExpandedProviders("p1", s);
    set = toggleExpandedProvider(set, "anthropic"); // open anthropic
    set = toggleExpandedProvider(set, LEAD_GROUP); // also open the first group
    saveExpandedProviders("p1", set, s);
    const restored = loadExpandedProviders("p1", s);
    expect(restored).toEqual(new Set(["anthropic", LEAD_GROUP]));
    expect(restored).not.toBe(set); // fresh instance per load (React state discipline)
  });

  it("an explicitly saved empty array keeps all groups collapsed", () => {
    const s = memStorage();
    saveExpandedProviders("p1", new Set(), s);
    expect(loadExpandedProviders("p1", s).size).toBe(0);
  });

  it("invalid JSON / non-array shapes fall back to the default; junk array elements are dropped", () => {
    const s = memStorage();
    for (const raw of ["{not json", '"deepseek"', "42", "null", "{}", ""]) {
      s.map.set(expandedGroupsKey("p1"), raw);
      expect([...loadExpandedProviders("p1", s)]).toEqual([]);
    }
    // An array survives element-level junk: non-strings are filtered, strings kept.
    s.map.set(expandedGroupsKey("p1"), '["anthropic", 7, null, {"x": 1}]');
    expect([...loadExpandedProviders("p1", s)]).toEqual(["anthropic"]);
  });

  it("Projects are isolated: each key holds its own set", () => {
    const s = memStorage();
    saveExpandedProviders("p1", new Set(["openai"]), s);
    saveExpandedProviders("p2", new Set(["moonshot", "my-proxy"]), s);
    expect([...loadExpandedProviders("p1", s)]).toEqual(["openai"]);
    expect(loadExpandedProviders("p2", s)).toEqual(new Set(["moonshot", "my-proxy"]));
    // A third Project is untouched by the writes above and opens on the default.
    expect([...loadExpandedProviders("p3", s)]).toEqual([]);
  });

  it("stale ids of since-deleted groups are harmless and survive round-trips", () => {
    const s = memStorage();
    saveExpandedProviders("p1", new Set(["deepseek", "deleted-group"]), s);
    const restored = loadExpandedProviders("p1", s);
    // Membership renders nothing by itself: current groups derive exactly as before …
    expect(isGroupExpanded(restored, "deepseek", false)).toBe(true);
    expect(isGroupExpanded(restored, "anthropic", false)).toBe(false);
    // … and the stored id cannot resurrect the group: only groups the rows produce render.
    const rows: ModelRowLike[] = [{ provider: "deepseek", modelId: "deepseek-chat" }];
    expect(groupModelRows(rows, "").some((g) => g.provider.id === "deleted-group")).toBe(false);
    // Toggling other groups keeps the stale id inert but persisted (pruning is not load's job).
    saveExpandedProviders("p1", toggleExpandedProvider(restored, "anthropic"), s);
    expect(loadExpandedProviders("p1", s).has("deleted-group")).toBe(true);
  });

  it("storage throwing (quota/private mode): save does not throw, load yields the default", () => {
    const broken: ExpansionStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => saveExpandedProviders("p1", new Set(["openai"]), broken)).not.toThrow();
    expect([...loadExpandedProviders("p1", broken)]).toEqual([]);
  });
});
