/**
 * model-group-order.ts unit tests plus the ordering behaviour it drives in
 * model-grouping.ts: the models page's manual order of the PROVIDER GROUPS.
 *
 * Dragging is the whole intent — no sort toggle and no pinning — so an empty stored
 * order must be the identity: a Project that has never been dragged renders exactly the
 * built-in catalog sequence. Beyond that: one array per Project, groups with no stored
 * place TRAILING (a group is created from a control below every group, so a new one must
 * not jump to the top), stale keys inert, the always-visible custom group still obeying
 * its own rule, and a drop committed against every group the library could show so an
 * empty built-in keeps its catalog place.
 *
 * Provider ids are read from MODEL_PROVIDERS rather than spelled out: this file is about
 * the ordering algebra, and the catalog's own membership is model-catalog.test.ts's.
 */
import { describe, expect, it } from "vitest";
import { MODEL_PROVIDERS } from "@prismshadow/penguin-core/model-catalog";

import {
  commitModelGroupOrder,
  loadModelGroupOrder,
  modelGroupOrderKey,
  orderModelGroups,
  saveModelGroupOrder,
} from "../src/features/models/model-group-order";
import type { ModelGroupOrderStorage } from "../src/features/models/model-group-order";
import {
  allGroupKeys,
  groupModelRows,
  orderModelsLikeLibrary,
  visibleChatModels,
} from "../src/features/models/model-grouping";
import type { ModelRowLike } from "../src/features/models/model-grouping";

/** In-memory storage (vitest runs in a Node environment, no localStorage; group-order.test.ts convention). */
function memStorage(): ModelGroupOrderStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

const CATALOG_IDS = MODEL_PROVIDERS.map((p) => p.id);

const rows: ModelRowLike[] = [
  { provider: "anthropic", modelId: "claude-sonnet-4-6" },
  { provider: "moonshot", modelId: "kimi-k2.6" },
  { provider: "minimax", modelId: "MiniMax-M3" },
  { provider: "custom", modelId: "my-proxy-model" },
  { provider: "zeta-vendor", modelId: "weird-model" },
  { provider: "alpha-vendor", modelId: "other-model" },
];

describe("model group order storage", () => {
  it("one array per Project, under the models page's key namespace", () => {
    const s = memStorage();
    expect(modelGroupOrderKey("p1")).toBe("penguin.modelsGroupOrder.p1");
    saveModelGroupOrder("p1", ["minimax", "anthropic"], s);
    saveModelGroupOrder("p2", ["moonshot"], s);
    expect(loadModelGroupOrder("p1", s)).toEqual(["minimax", "anthropic"]);
    expect(loadModelGroupOrder("p2", s)).toEqual(["moonshot"]);
    // A Project switch cannot leak one arrangement into another.
    expect([...s.map.keys()].sort()).toEqual([
      "penguin.modelsGroupOrder.p1",
      "penguin.modelsGroupOrder.p2",
    ]);
  });

  it("no Project reads and writes nothing (the page renders before one resolves)", () => {
    const s = memStorage();
    saveModelGroupOrder(null, ["minimax"], s);
    expect(s.map.size).toBe(0);
    expect(loadModelGroupOrder(null, s)).toEqual([]);
  });

  it("nothing stored, or anything malformed, degrades to the empty order (i.e. the catalog sequence)", () => {
    const s = memStorage();
    expect(loadModelGroupOrder("p1", s)).toEqual([]);
    for (const raw of ["{not json", '"minimax"', "42", "null", "{}", ""]) {
      s.map.set(modelGroupOrderKey("p1"), raw);
      expect(loadModelGroupOrder("p1", s)).toEqual([]);
    }
    // Junk elements are dropped, the string ids around them survive.
    s.map.set(modelGroupOrderKey("p1"), '["minimax", 7, null, {"x": 1}, "anthropic"]');
    expect(loadModelGroupOrder("p1", s)).toEqual(["minimax", "anthropic"]);
  });

  it("storage that throws degrades instead of escaping — load runs from a useState initializer", () => {
    const hostile = {
      get getItem(): never {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    } as unknown as ModelGroupOrderStorage;
    expect(() => loadModelGroupOrder("p1", hostile)).not.toThrow();
    expect(loadModelGroupOrder("p1", hostile)).toEqual([]);
    const broken: ModelGroupOrderStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => saveModelGroupOrder("p1", ["minimax"], broken)).not.toThrow();
  });

  it("with NO storage injected, resolving localStorage is itself inside the try", () => {
    // vitest runs this package in Node, where `localStorage` is not defined at all — the
    // same shape as a browser that throws on touching it. Omitting the argument is the
    // only way to reach that branch, and it is the one the page's useState initializer
    // takes, where an escaping throw would take the first render down.
    expect(() => loadModelGroupOrder("p1")).not.toThrow();
    expect(loadModelGroupOrder("p1")).toEqual([]);
    expect(() => saveModelGroupOrder("p1", ["minimax"])).not.toThrow();
  });
});

describe("allGroupKeys (the sequence a drop is committed against)", () => {
  it("every built-in provider — empty ones included — then the user-defined groups, sorted", () => {
    expect(allGroupKeys(rows)).toEqual([...CATALOG_IDS, "alpha-vendor", "zeta-vendor"]);
    // Holding no models at all still yields the full built-in list: that is the point —
    // a provider gaining its first model must not arrive as a newcomer.
    expect(allGroupKeys([])).toEqual(CATALOG_IDS);
  });
});

describe("groupModelRows with a manual group order", () => {
  const idsOf = (order: readonly string[] = []) =>
    groupModelRows(rows, "", order).map((g) => g.provider.id);

  it("an empty order is the identity: the catalog sequence, user-defined groups last", () => {
    expect(idsOf()).toEqual([
      "anthropic",
      "moonshot",
      "minimax",
      "custom",
      "alpha-vendor",
      "zeta-vendor",
    ]);
  });

  it("named groups take the stored order; unnamed ones keep their catalog order and TRAIL", () => {
    // minimax and anthropic are placed; the rest are unplaced and follow them, keeping
    // their own relative catalog order.
    expect(idsOf(["minimax", "anthropic"])).toEqual([
      "minimax",
      "anthropic",
      "moonshot",
      "custom",
      "alpha-vendor",
      "zeta-vendor",
    ]);
  });

  it("a group created after the order was stored appears at the BOTTOM, not the top", () => {
    // The control that creates a user-defined group sits below every group on the page, so
    // the group it makes must not leap over the whole arrangement.
    const stored = commitModelGroupOrder([], allGroupKeys(rows), "minimax", "anthropic", false);
    const ids = groupModelRows([...rows, { provider: "brand-new", modelId: "m1" }], "", stored).map(
      (g) => g.provider.id,
    );
    expect(ids.at(-1)).toBe("brand-new");
    // Being unplaced is what puts it last, not its name — with no order stored, the
    // automatic sort files it between the two user-defined groups already on the page.
    const automatic = groupModelRows(
      [...rows, { provider: "brand-new", modelId: "m1" }],
      "",
      [],
    ).map((g) => g.provider.id);
    expect(automatic.at(-1)).toBe("zeta-vendor");
    expect(automatic.indexOf("brand-new")).toBeLessThan(automatic.indexOf("zeta-vendor"));
  });

  it("a user-defined group can be dragged above the built-ins", () => {
    expect(idsOf(["zeta-vendor", ...CATALOG_IDS, "alpha-vendor"])).toEqual([
      "zeta-vendor",
      "anthropic",
      "moonshot",
      "minimax",
      "custom",
      "alpha-vendor",
    ]);
  });

  it("a stored order survives a change to the catalog's DEFAULT sequence", () => {
    // A drop materialises every group key, so any Project that has ever reordered its
    // groups holds a full arrangement — and re-curating MODEL_PROVIDERS cannot move a
    // single group for that user. Only a Project with nothing stored follows the default.
    const dropped = commitModelGroupOrder([], allGroupKeys(rows), "minimax", "anthropic", false);
    expect(dropped).toEqual(expect.arrayContaining(CATALOG_IDS));
    const before = groupModelRows(rows, "", dropped).map((g) => g.provider.id);
    // Simulate a later release promoting some group to the front of the catalog order: the
    // stored array pins every key, so the rendered order is unchanged.
    const recurated = [
      CATALOG_IDS.at(-2)!,
      ...CATALOG_IDS.filter((id) => id !== CATALOG_IDS.at(-2)),
    ];
    expect(recurated).not.toEqual(CATALOG_IDS);
    const after = orderModelGroups(
      recurated.map((id) => ({ id })),
      (g) => g.id,
      dropped,
    ).map((g) => g.id);
    expect(after).toEqual(
      orderModelGroups(
        CATALOG_IDS.map((id) => ({ id })),
        (g) => g.id,
        dropped,
      ).map((g) => g.id),
    );
    expect(before).toEqual(groupModelRows(rows, "", dropped).map((g) => g.provider.id));
  });

  it("stale keys are inert — a stored group that no longer exists changes nothing", () => {
    expect(idsOf(["gone-vendor", "minimax", "also-gone"])).toEqual(idsOf(["minimax"]));
  });

  it("custom keeps its own rule: shown even when empty, at whatever place the order gives it", () => {
    const withoutCustomRows = rows.filter((r) => r.provider !== "custom");
    // Unplaced and empty: still rendered (it hosts the add entry point), in catalog order.
    expect(groupModelRows(withoutCustomRows, "", []).map((g) => g.provider.id)).toContain("custom");
    // Dragged to the front while still empty. Every group is named in the order, so none
    // is unplaced and surfacing above it.
    const keys = allGroupKeys(withoutCustomRows);
    const ordered = groupModelRows(withoutCustomRows, "", [
      "custom",
      ...keys.filter((id) => id !== "custom"),
    ]);
    expect(ordered[0]!.provider.id).toBe("custom");
    expect(ordered[0]!.rows).toEqual([]);
  });

  it("a search query still filters to matches, and empty groups other than custom stay dropped", () => {
    const found = groupModelRows(rows, "kimi", ["minimax", "anthropic"]);
    expect(found.map((g) => g.provider.id)).toEqual(["moonshot"]);
  });
});

describe("the chat model picker follows the same order", () => {
  it("orderModelsLikeLibrary and visibleChatModels both take the stored order", () => {
    const order = ["minimax", "anthropic"];
    expect(orderModelsLikeLibrary(rows, order).map((r) => r.provider)).toEqual([
      "minimax",
      "anthropic",
      "moonshot",
      "custom",
      "alpha-vendor",
      "zeta-vendor",
    ]);
    // No model here has a key, so the key filter degrades to "show everything" and the
    // group order is the only thing deciding the sequence.
    const visible = visibleChatModels(rows, { showAll: false, query: "", groupOrder: order });
    expect(visible.map((r) => r.provider)).toEqual(
      orderModelsLikeLibrary(rows, order).map((r) => r.provider),
    );
  });
});

describe("orderModelGroups (the placement rule the commit half has to match)", () => {
  const keys = ["a", "b", "c", "d"];
  const id = (x: string) => x;

  it("an empty order is the identity", () => {
    expect(orderModelGroups(keys, id, [])).toEqual(keys);
  });

  it("placed keys take the stored sequence, unplaced ones trail in their input order", () => {
    expect(orderModelGroups(keys, id, ["d", "b"])).toEqual(["d", "b", "a", "c"]);
  });

  it("stored keys naming nothing are simply absent from the result", () => {
    expect(orderModelGroups(keys, id, ["gone", "c"])).toEqual(["c", "a", "b", "d"]);
  });
});

describe("committing a drop against the full group list", () => {
  it("the first drop materialises the catalog order with one group moved", () => {
    const keys = allGroupKeys(rows);
    const first = keys[0]!;
    const third = keys[2]!;
    const stored = commitModelGroupOrder([], keys, first, third, true);
    expect(stored).toEqual([keys[1], keys[2], first, ...keys.slice(3)]);
    // Everything is placed, so nothing surfaces to the top on the next render.
    expect(groupModelRows(rows, "", stored).map((g) => g.provider.id)).toEqual(
      (stored as string[]).filter((id) =>
        groupModelRows(rows, "", []).some((g) => g.provider.id === id),
      ),
    );
  });

  it("a provider holding no models keeps its catalog place, and appears there once it gains one", () => {
    const keys = allGroupKeys(rows);
    // The LAST built-in group with no rows in the fixture: it never renders today, and it
    // sits late enough in the catalog that "did not jump to the front" is a real claim.
    const empty = [...CATALOG_IDS]
      .reverse()
      .find((id) => id !== "custom" && !rows.some((r) => r.provider === id))!;
    const stored = commitModelGroupOrder([], keys, "minimax", "anthropic", false);
    expect(stored).toContain(empty);
    const before = groupModelRows(rows, "", stored).map((g) => g.provider.id);
    const after = groupModelRows(
      [...rows, { provider: empty, modelId: "newly-added" }],
      "",
      stored,
    ).map((g) => g.provider.id);
    // It slots into the arrangement instead of arriving at the top as an unplaced newcomer,
    // and disturbs nothing already on screen.
    expect(after[0]).not.toBe(empty);
    expect(after.filter((id) => id !== empty)).toEqual(before);
    // The render is the stored order, filtered to the groups that have something to show.
    expect(after).toEqual((stored as string[]).filter((id) => after.includes(id)));
  });

  it("a drop that moves nothing returns the input array, so nothing is persisted", () => {
    const keys = allGroupKeys(rows);
    const order = [...keys];
    expect(commitModelGroupOrder(order, keys, keys[0]!, keys[0]!, false)).toBe(order);
    // Dropping just above the neighbour it already sits above changes no sequence.
    expect(commitModelGroupOrder(order, keys, keys[0]!, keys[1]!, false)).toBe(order);
  });
});
