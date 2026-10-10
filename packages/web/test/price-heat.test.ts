/**
 * The price dot on a model card, and the heat it is painted from.
 *
 * The heat (price-heat.ts):
 * - Given either price rising — the uncached input or the output — the dot never cools.
 * - Given a price below the ramp's cool bound or above its hot bound, the dot holds at that end.
 * - Given a free row (three zero buckets, numbers or "0" strings) or an unpriced one (blank or
 *   missing buckets), there is no heat at all.
 * - Given a vendor's yuan price and the same price written in dollars, both land in one place
 *   and one level — even on a breakpoint, where a price takes the upper word.
 * - Given the catalog's familiar classes, a nano row reads low and an Opus row very high.
 *
 * The card (models-page.tsx):
 * - A priced card leads its third line with the dot, whose name gives the level and the blended
 *   figure, in zh and in en, and the price follows it before the context window.
 * - A free card shows its badge and no dot; an unpriced card shows neither a price nor a dot.
 * - In yuan, the dot's name gives the yuan figure and the same level.
 * - The dot reads the price billed now: a running promotion cools it, and a scheduled row's dot
 *   changes with the clock as its printed price does.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogEntryFor } from "@prismshadow/penguin-core/model-catalog";
import { ModelCard } from "../src/features/models/models-page";
import type { RowState } from "../src/features/models/models-page";
import { roughPrice } from "../src/features/models/price-format";
import {
  PRICE_HEAT_BOUNDS_USD,
  blendedPrice,
  priceHeat,
  priceLevel,
} from "../src/features/models/price-heat";
import type { PriceLevel } from "../src/features/models/price-heat";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import type { Currency } from "../src/state/theme";

afterEach(() => {
  setActiveStrings(zh);
  vi.useRealTimers();
});

/** A catalog row's stored (USD) prices, as the page's string fields carry them. */
function catalogBuckets(provider: string, modelId: string) {
  const pricing = catalogEntryFor(provider, modelId)?.pricing;
  if (pricing === undefined) throw new Error(`${provider}/${modelId} has no catalog price`);
  return {
    cacheRead: String(pricing.cache_read),
    cacheWrite: String(pricing.cache_write),
    output: String(pricing.output),
  };
}

describe("price heat", () => {
  it("never cools as either price rises", () => {
    const ladder = Array.from({ length: 40 }, (_, i) => 0.001 * 1.5 ** i); // $0.001 … ~$5,000
    for (const fixed of [0.05, 1, 40]) {
      const byInput = ladder.map((v) => priceHeat({ cacheWrite: v, output: fixed })!.t);
      const byOutput = ladder.map((v) => priceHeat({ cacheWrite: fixed, output: v })!.t);
      for (const series of [byInput, byOutput]) {
        series.slice(1).forEach((t, i) => expect(t).toBeGreaterThanOrEqual(series[i]!));
        // And it does warm: the sweep crosses the whole ramp.
        expect(series[0]).toBeLessThan(series.at(-1)!);
      }
    }
  });

  it("holds at the cool end below the ramp and at the hot end above it", () => {
    const { cool, hot } = PRICE_HEAT_BOUNDS_USD;
    expect(priceHeat({ cacheWrite: cool, output: cool })!.t).toBe(0);
    expect(priceHeat({ cacheWrite: cool / 10, output: cool / 100 })!.t).toBe(0);
    expect(priceHeat({ cacheWrite: hot, output: hot })!.t).toBe(1);
    expect(priceHeat({ cacheWrite: hot * 10, output: hot * 3 })!.t).toBe(1);
    const inside = priceHeat({ cacheWrite: 1, output: 4 })!.t;
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(1);
  });

  it("has nothing to say about a free row or an unpriced one", () => {
    expect(priceHeat({ cacheRead: 0, cacheWrite: 0, output: 0 })).toBeUndefined();
    expect(priceHeat({ cacheRead: "0", cacheWrite: "0", output: "0" })).toBeUndefined();
    expect(priceHeat({ cacheRead: "", cacheWrite: "", output: "" })).toBeUndefined();
    expect(priceHeat({})).toBeUndefined();
    // Half a price is not a price.
    expect(priceHeat({ cacheRead: "0.1", cacheWrite: "", output: "2" })).toBeUndefined();
  });

  it("puts a yuan price where the same price in dollars goes, and a breakpoint on its upper word", () => {
    // DeepSeek Flash is listed at ¥2 / ¥8 and stored in dollars rounded to a millionth: its blend
    // is ¥3.5, exactly the low/medium breakpoint ($0.5).
    const yuan = priceHeat(catalogBuckets("deepseek", "deepseek-flash"))!;
    const dollars = priceHeat({ cacheWrite: 2 / 7, output: 8 / 7 })!;
    expect(yuan.level).toBe("medium");
    expect(dollars.level).toBe("medium");
    expect(yuan.t).toBeCloseTo(dollars.t, 5);
    expect([0.5, 2, 8].map(priceLevel)).toEqual(["medium", "high", "veryHigh"]);
    expect([0.4999, 1.9999, 7.9999].map(priceLevel)).toEqual(["low", "medium", "high"]);
  });

  it("reads a nano model as low and an Opus model as very high", () => {
    expect(priceHeat(catalogBuckets("openrouter", "openai/gpt-5.4-nano"))!.level).toBe("low");
    expect(priceHeat(catalogBuckets("anthropic", "claude-sonnet-5-5"))!.level).toBe("high");
    expect(priceHeat(catalogBuckets("anthropic", "claude-opus-5-5"))!.level).toBe("veryHigh");
  });
});

const row = (patch: Partial<RowState>): RowState => ({
  provider: "custom",
  modelId: "house-model",
  original: null,
  vision: false,
  contextWindow: "128000",
  maxTokens: "",
  fastMode: false,
  clientType: "openai-chat",
  cacheRead: "",
  cacheWrite: "",
  output: "",
  baseUrl: "",
  originalBaseUrl: "",
  apiKeyInput: "",
  clearApiKey: false,
  ...patch,
});

const render = (patch: Partial<RowState>, currency: Currency = "USD") =>
  renderToStaticMarkup(
    createElement(ModelCard, {
      row: row(patch),
      currency,
      isDefault: false,
      isVisionModel: false,
      hourTick: 0,
      onOpen: () => {},
    }),
  );

/** The name the card gives its price dot, if it has one. */
function dotName(html: string): string | undefined {
  // The dot is the one mark painted from the heat ramp; its name rides the hit box around it.
  const match = /<span[^>]*aria-label="([^"]*)"[^>]*><span[^>]*--ui-heat-/.exec(html);
  return match?.[1];
}

const named = (level: PriceLevel, figure: string) =>
  S.models.priceHeatTitle(S.models.priceHeatLevel[level], figure);

/** The card's visible text, tags stripped. */
const text = (html: string) => html.replace(/<[^>]+>/g, "");

/** Blended $2.5 at list: (2 × 3 + 4) ÷ 4. */
const PRICED = { cacheRead: "0.5", cacheWrite: "2", output: "4" };

describe("the price dot on a model card", () => {
  it("leads the third line, named with its level and blended figure, the price right after it", () => {
    const html = render(PRICED);
    const zhName = dotName(html);
    expect(zhName).toBe(named("high", "$2.5"));
    expect(text(html)).toContain("$0.5 / $2 / $4 · 128");
    setActiveStrings(en);
    const enName = dotName(render(PRICED));
    expect(enName).toBe(named("high", "$2.5"));
    expect(enName).not.toBe(zhName);
  });

  it("is left off a free card, whose badge is its mark, and off an unpriced one", () => {
    const free = render({ cacheRead: "0", cacheWrite: "0", output: "0" });
    expect(text(free)).toContain(S.models.freeBadge);
    expect(free).not.toContain("--ui-heat-");
    const unpriced = render({});
    expect(text(unpriced)).not.toContain("$");
    expect(unpriced).not.toContain("--ui-heat-");
  });

  it("gives the yuan figure in yuan, at the same level", () => {
    expect(dotName(render(PRICED, "CNY"))).toBe(named("high", "¥17.5"));
  });

  it("cools with a running promotion, as the printed price does", () => {
    // Half price bills (1 × 3 + 2) ÷ 4 = $1.25: medium, where the list price is high.
    const html = render({ ...PRICED, discount: 0.5 });
    expect(dotName(html)).toBe(named("medium", "$1.25"));
    expect(text(html)).toContain("$0.25 / $1 / $2 · 128");
  });

  it("follows a scheduled row's clock, as the printed price does", () => {
    const deepseek = { provider: "deepseek", modelId: "deepseek-flash", clientType: "" };
    const buckets = catalogBuckets("deepseek", "deepseek-flash");
    const peak = blendedPrice(Number(buckets.cacheWrite), Number(buckets.output));
    vi.useFakeTimers({ toFake: ["Date"] });
    // Wednesday 10:00 Beijing time, inside DeepSeek's peak window: the list price.
    vi.setSystemTime(new Date("2026-10-07T02:00:00Z"));
    expect(dotName(render({ ...deepseek, ...buckets }))).toBe(
      named(priceLevel(peak), roughPrice(peak, "USD")),
    );
    // 13:00, off-peak: half of it, and a cooler word.
    vi.setSystemTime(new Date("2026-10-07T05:00:00Z"));
    expect(dotName(render({ ...deepseek, ...buckets }))).toBe(
      named(priceLevel(peak / 2), roughPrice(peak / 2, "USD")),
    );
    expect(priceLevel(peak / 2)).not.toBe(priceLevel(peak));
  });
});
