/**
 * The order of the models inside each group on the models page (model-sort.ts), and where each
 * group's choice is kept.
 *
 * - Given no choice for a group, its models are listed by the blended price billed right now,
 *   cheapest first; the blend weighs three parts input (cache write) to one part output.
 * - Given "price, high to low", the dearest model comes first.
 * - Given "name", models are listed by the name their card shows (the model id when they have
 *   none), case ignored and digit runs read as numbers — GLM-5.2 before GLM-5.10 — in either UI
 *   language.
 * - A free model leads the low-to-high order; a model with no price ends the list in both
 *   directions; equal prices fall back to the name.
 * - A running promotion, and an off-peak hour, move a model exactly as far as they move the
 *   price on its card; at peak it is back at its list price and its place.
 * - A search's matches keep their group's sort, and sorting never moves a group.
 * - A choice is kept per group, in this browser: another group stays on price low to high, and
 *   the choice is read back after a reload. Choosing price low to high again forgets it; a choice
 *   that changes nothing is not written.
 * - Storage that throws, or holds anything but known sorts, leaves every group on price low to
 *   high, and a failed write is swallowed.
 * - A user-defined group named like an Object method keeps its own choice.
 */
import { describe, expect, it } from "vitest";
import { catalogEntryFor } from "@prismshadow/penguin-core/model-catalog";
import { groupModelRows } from "../src/features/models/model-grouping";
import type { ModelRowLike, PricingBucketsLike } from "../src/features/models/model-grouping";
import {
  MODEL_GROUP_SORTS_KEY,
  blendedPrice,
  initialModelGroupSorts,
  modelGroupSortOf,
  sortGroupRows,
  sortModelGroups,
  storeModelGroupSorts,
  withModelGroupSort,
} from "../src/features/models/model-sort";
import { blockedStorage, memoryStorage, stubLocalStorage } from "./helpers/storage";

type Row = ModelRowLike & PricingBucketsLike;

/** A row in a group of hand-added models, priced in USD per million Tokens ("" = no price). */
const row = (
  modelId: string,
  [cacheRead, cacheWrite, output]: [string, string, string],
  extra: Partial<Row> = {},
): Row => ({ provider: "openrouter", modelId, cacheRead, cacheWrite, output, ...extra });

const NOW = new Date("2026-10-10T12:00:00Z");
const ids = (rows: readonly Row[]): string[] => rows.map((r) => r.modelId);

/** Blended, (3 × cache write + output) ÷ 4: 0.875, 3.5, 0.5 and 7 per million. */
const cheap = row("cheap", ["0.1", "0.5", "2"]);
const mid = row("mid", ["0.2", "2", "8"]);
const tiny = row("tiny", ["0.01", "0.2", "1.4"]);
const dear = row("dear", ["1", "5", "13"]);
const free = row("free", ["0", "0", "0"]);
const unpriced = row("unpriced", ["", "", ""]);

describe("sorting a group's models", () => {
  it("with no choice made, a group lists its models by the price billed now, cheapest first", () => {
    const [group] = sortModelGroups(groupModelRows([mid, dear, cheap, tiny], ""), {}, NOW, "en");
    expect(ids(group!.rows)).toEqual(["tiny", "cheap", "mid", "dear"]);
  });

  it("the price weighs three parts input to one part output", () => {
    // Output alone, or an even mix, would put the second one first; the 3:1 blend does not.
    const inputCheap = row("input-cheap", ["0.01", "0.1", "3"]); // (0.3 + 3) / 4 = 0.825
    const evenlyPriced = row("evenly-priced", ["0.1", "1", "1"]); // (3 + 1) / 4 = 1
    expect(blendedPrice(inputCheap, NOW)).toBeCloseTo(0.825, 9);
    expect(ids(sortGroupRows([evenlyPriced, inputCheap], "price-asc", NOW, "en"))).toEqual([
      "input-cheap",
      "evenly-priced",
    ]);
  });

  it("price high to low lists the dearest model first", () => {
    expect(ids(sortGroupRows([cheap, dear, tiny, mid], "price-desc", NOW, "en"))).toEqual([
      "dear",
      "mid",
      "cheap",
      "tiny",
    ]);
  });

  it.each(["en", "zh"])(
    "by name (%s), models are listed by the name their card shows, digit runs read as numbers",
    (locale) => {
      const rows = [
        row("z-ai/glm-5.10", ["1", "1", "1"], { displayName: "GLM-5.10" }),
        row("z-ai/glm-5.2", ["9", "9", "9"], { displayName: "GLM-5.2" }),
        // No display name: the card shows the id, and so does the order.
        row("deepseek-flash", ["1", "1", "1"]),
        // A name cleared to blanks reads as no name at all.
        row("ant/claude", ["1", "1", "1"], { displayName: "  " }),
        row("x/glm-5.3", ["1", "1", "1"], { displayName: "glm-5.3" }),
      ];
      expect(ids(sortGroupRows(rows, "name", NOW, locale))).toEqual([
        "ant/claude",
        "deepseek-flash",
        "z-ai/glm-5.2",
        "x/glm-5.3",
        "z-ai/glm-5.10",
      ]);
    },
  );

  it("a free model leads low to high, and a model with no price ends the list either way", () => {
    const rows = [unpriced, cheap, free, dear];
    expect(ids(sortGroupRows(rows, "price-asc", NOW, "en"))).toEqual([
      "free",
      "cheap",
      "dear",
      "unpriced",
    ]);
    expect(ids(sortGroupRows(rows, "price-desc", NOW, "en"))).toEqual([
      "dear",
      "cheap",
      "free",
      "unpriced",
    ]);
    // A price missing a bucket saves as no price at all, so it sorts as one.
    const partial = row("partial", ["", "0.1", "0.1"]);
    expect(blendedPrice(partial, NOW)).toBeUndefined();
    expect(ids(sortGroupRows([partial, cheap], "price-asc", NOW, "en"))).toEqual([
      "cheap",
      "partial",
    ]);
  });

  it("equal prices, and models with no price, fall back to the name", () => {
    const rows = [
      row("b-twin", ["0.1", "0.5", "2"]),
      row("unpriced-b", ["", "", ""]),
      row("a-twin", ["0.3", "0.5", "2"]),
      row("unpriced-a", ["", "", ""]),
    ];
    for (const sort of ["price-asc", "price-desc"] as const) {
      expect(ids(sortGroupRows(rows, sort, NOW, "en")), sort).toEqual([
        "a-twin",
        "b-twin",
        "unpriced-a",
        "unpriced-b",
      ]);
    }
  });

  it("a running promotion moves a model as far as it moves the price on its card", () => {
    const list = row("promoted", ["0.2", "1", "4"]); // 1.75 at list price
    const rival = row("rival", ["0.2", "1", "2"]); // 1.25
    expect(ids(sortGroupRows([list, rival], "price-asc", NOW, "en"))).toEqual([
      "rival",
      "promoted",
    ]);
    // Half off: the card prints 0.5 / 2, blended 0.875.
    const promoted = { ...list, discount: 0.5 };
    expect(blendedPrice(promoted, NOW)).toBe(0.875);
    expect(ids(sortGroupRows([promoted, rival], "price-asc", NOW, "en"))).toEqual([
      "promoted",
      "rival",
    ]);
  });

  it("an off-peak hour moves a scheduled model ahead, and the peak hour puts it back", () => {
    // DeepSeek's own row as a new Project stores it: its peak price, in USD though DeepSeek
    // quotes CNY, so it compares with a USD-priced rival as it stands.
    const pricing = catalogEntryFor("deepseek", "deepseek-flash")!.pricing!;
    const scheduled: Row = {
      provider: "deepseek",
      modelId: "deepseek-flash",
      cacheRead: String(pricing.cache_read),
      cacheWrite: String(pricing.cache_write),
      output: String(pricing.output),
    };
    // Three quarters of DeepSeek's peak rate: dearer than its off-peak half, cheaper than peak.
    const rival = row(
      "rival",
      [
        String(pricing.cache_read * 0.75),
        String(pricing.cache_write * 0.75),
        String(pricing.output * 0.75),
      ],
      { provider: "deepseek" },
    );
    // Beijing is UTC+8; 2026-08-31 is a Monday, so 09:30 there is peak and 13:00 off-peak.
    const peak = new Date("2026-08-31T01:30:00Z");
    const offPeak = new Date("2026-08-31T05:00:00Z");
    expect(ids(sortGroupRows([scheduled, rival], "price-asc", peak, "en"))).toEqual([
      "rival",
      "deepseek-flash",
    ]);
    expect(ids(sortGroupRows([scheduled, rival], "price-asc", offPeak, "en"))).toEqual([
      "deepseek-flash",
      "rival",
    ]);
  });

  it("a search's matches keep their group's sort, and no group moves", () => {
    const rows = [
      dear,
      row("glm-b", ["0.1", "0.4", "1"], { provider: "zhipu" }),
      mid,
      row("glm-a", ["0.1", "0.9", "1"], { provider: "zhipu" }),
      cheap,
    ];
    // Z.AI dragged to the top and sorted by name; OpenRouter left on the default.
    const order = ["zhipu"];
    const sorts = withModelGroupSort({}, "zhipu", "name");
    const unsorted = groupModelRows(rows, "", order);
    const groups = sortModelGroups(unsorted, sorts, NOW, "en");
    expect(groups.map((g) => g.provider.id)).toEqual(unsorted.map((g) => g.provider.id));
    expect(groups.map((g) => [g.provider.id, ids(g.rows)])).toEqual([
      ["zhipu", ["glm-a", "glm-b"]],
      ["openrouter", ["cheap", "mid", "dear"]],
      ["custom", []],
    ]);
    // "ea" finds dear and cheap, in the order the whole group would list them.
    const found = sortModelGroups(groupModelRows(rows, "ea", order), sorts, NOW, "en");
    expect(found.map((g) => [g.provider.id, ids(g.rows)])).toEqual([
      ["openrouter", ["cheap", "dear"]],
    ]);
  });
});

describe("remembering each group's sort", () => {
  it("a choice is kept for its group alone, and read back after a reload", () => {
    const storage = memoryStorage();
    const chosen = withModelGroupSort({}, "openrouter", "name");
    storeModelGroupSorts(chosen, storage);
    const reloaded = initialModelGroupSorts(storage);
    expect(modelGroupSortOf(reloaded, "openrouter")).toBe("name");
    expect(modelGroupSortOf(reloaded, "tokendance")).toBe("price-asc");
  });

  it("choosing price low to high again forgets the group's choice, and a no-op is not written", () => {
    const storage = memoryStorage();
    const chosen = withModelGroupSort(
      withModelGroupSort({}, "openrouter", "price-desc"),
      "tokendance",
      "name",
    );
    const reset = withModelGroupSort(chosen, "openrouter", "price-asc");
    storeModelGroupSorts(reset, storage);
    expect(JSON.parse(storage.map.get(MODEL_GROUP_SORTS_KEY)!)).toEqual({ tokendance: "name" });
    // The page skips the write when the same object comes back.
    expect(withModelGroupSort(reset, "tokendance", "name")).toBe(reset);
    expect(withModelGroupSort(reset, "deepseek", "price-asc")).toBe(reset);
  });

  it.each<[string, () => Storage]>([
    ["blocked", () => blockedStorage()],
    ["unparseable", () => memoryStorage({ [MODEL_GROUP_SORTS_KEY]: "{not json" })],
    ["not an object", () => memoryStorage({ [MODEL_GROUP_SORTS_KEY]: '["name"]' })],
    ["null", () => memoryStorage({ [MODEL_GROUP_SORTS_KEY]: "null" })],
  ])("%s storage leaves every group on price low to high", (_, storage) => {
    const sorts = initialModelGroupSorts(storage());
    expect(modelGroupSortOf(sorts, "openrouter")).toBe("price-asc");
  });

  it("keeps only known sorts under a group id, and swallows a write that fails", () => {
    const stored = memoryStorage({
      [MODEL_GROUP_SORTS_KEY]: JSON.stringify({
        openrouter: "name",
        tokendance: "cheapest",
        deepseek: 3,
        "": "price-desc",
        google: "price-asc",
      }),
    });
    expect(initialModelGroupSorts(stored)).toEqual({ openrouter: "name" });
    expect(() => storeModelGroupSorts({ openrouter: "name" }, blockedStorage())).not.toThrow();
  });

  it("reads and writes this browser's localStorage when no storage is given", () => {
    const storage = stubLocalStorage();
    storeModelGroupSorts(withModelGroupSort({}, "openrouter", "name"));
    expect(storage.map.has(MODEL_GROUP_SORTS_KEY)).toBe(true);
    expect(modelGroupSortOf(initialModelGroupSorts(), "openrouter")).toBe("name");
    // A browser with site data blocked throws on every call, the global included.
    stubLocalStorage(blockedStorage());
    expect(modelGroupSortOf(initialModelGroupSorts(), "openrouter")).toBe("price-asc");
    expect(() => storeModelGroupSorts({ openrouter: "name" })).not.toThrow();
  });

  it("a user-defined group named like an Object method keeps its own choice", () => {
    for (const id of ["constructor", "toString", "__proto__"]) {
      expect(modelGroupSortOf({}, id), id).toBe("price-asc");
      const chosen = withModelGroupSort({}, id, "name");
      expect(modelGroupSortOf(chosen, id), id).toBe("name");
      const storage = memoryStorage();
      storeModelGroupSorts(chosen, storage);
      expect(modelGroupSortOf(initialModelGroupSorts(storage), id), id).toBe("name");
    }
  });
});
