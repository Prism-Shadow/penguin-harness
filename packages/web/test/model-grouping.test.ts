/**
 * model-grouping.ts unit tests: search filtering (id / display name / provider name,
 * case-insensitive) and grouping by provider — grouping reads the row's **provider field**
 * directly ((provider, model_id) are stored as separate columns; id is never concatenated
 * or split anywhere); built-in group order follows MODEL_PROVIDERS with custom last, and any
 * provider not in the catalog becomes a custom-built group — each forms its own
 * group, sorted by name and appended after custom; empty groups are hidden, except the
 * custom group, which is always shown when there's no search query, hosting the generic
 * "add model" entry point. Also covers the chat dropdown's visibility rule (visibleChatModels):
 * models with a key only by default (a stored masked key or a masked env fallback, judged by
 * hasConfiguredKey), selected/default always visible, everything listed when nothing is
 * configured or on showAll.
 */
import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_OFF_PEAK,
  MODEL_CATALOG,
  MODEL_PROVIDERS,
  QWEN_OFF_PEAK,
  catalogEntryFor,
  effectivePricing,
} from "@prismshadow/penguin-core/model-catalog";
import {
  discountedPrice,
  groupModelRows,
  hasConfiguredKey,
  isFreeModel,
  matchesQuery,
  orderModelsLikeLibrary,
  peakWindows,
  promotedPricing,
  visibleChatModels,
} from "../src/features/models/model-grouping";
import type { ModelCredentialRowLike, ModelRowLike } from "../src/features/models/model-grouping";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const rows: ModelRowLike[] = [
  { provider: "anthropic", modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
  { provider: "anthropic", modelId: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
  { provider: "moonshot", modelId: "kimi-k2.6", displayName: "Kimi K2.6" },
  { provider: "minimax", modelId: "MiniMax-M3", displayName: "MiniMax M3" },
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
    const customRow = rows.find((row) => row.provider === "custom")!;
    const customBuiltRow = rows.find((row) => row.provider === "unknown-vendor")!;
    expect(matchesQuery(customRow, "proxy")).toBe(true);
    expect(matchesQuery(customRow, "custom")).toBe(true);
    // Custom-built groups are searchable by their group name (raw provider value); no longer folded into the Custom bucket.
    expect(matchesQuery(customBuiltRow, "unknown-vendor")).toBe(true);
    expect(matchesQuery(customBuiltRow, "custom")).toBe(false);
  });
});

describe("groupModelRows", () => {
  it("groups by the row's provider (order follows MODEL_PROVIDERS), custom last, custom-built groups appended after", () => {
    const groups = groupModelRows(rows, "");
    expect(groups.map((g) => g.provider.id)).toEqual([
      "anthropic",
      "moonshot",
      "minimax",
      "custom",
      "unknown-vendor",
    ]);
    expect(groups[0]!.rows.map((r) => r.modelId)).toEqual(["claude-sonnet-4-6", "claude-opus-4-8"]);
    expect(groups[2]!.provider.label).toBe("MiniMax");
    expect(groups[2]!.rows.map((r) => r.modelId)).toEqual(["MiniMax-M3"]);
    expect(groups[3]!.rows.map((r) => r.modelId)).toEqual(["my-proxy-model"]);
    // Custom-built group: synthesized provider info — label is the group name, OpenAI-protocol semantics (env falls back to OPENAI_*).
    expect(groups[4]!.provider.label).toBe("unknown-vendor");
    expect(groups[4]!.provider.envKey).toBe("OPENAI_API_KEY");
    expect(groups[4]!.rows.map((r) => r.modelId)).toEqual(["weird-model"]);
    // Group order matches MODEL_PROVIDERS, whose sequence is hand-curated (gateways and
    // first-party vendors interleaved): the recommended TokenDance first, then Penguin Go,
    // OpenCode Go and DeepSeek, with custom last. This is the page's DEFAULT — the
    // stored per-Project order applied below overrides it.
    expect(MODEL_PROVIDERS.map((p) => p.id)).toEqual([
      "tokendance",
      "penguin-go",
      "opencode-go",
      "deepseek",
      "openrouter",
      "fireworks",
      "google",
      "openai",
      "anthropic",
      "siliconflow",
      "zhipu",
      "moonshot",
      "minimax",
      "qwen-pay-as-you-go",
      "qwen-token-plan",
      "vllm",
      "custom",
    ]);
    expect(MODEL_PROVIDERS.find((p) => p.id === "siliconflow")!.label).toBe("SiliconFlow");
    expect(MODEL_PROVIDERS.find((p) => p.id === "minimax")!.label).toBe("MiniMax");
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

describe("hasConfiguredKey", () => {
  it("a stored (masked) key counts as configured", () => {
    expect(
      hasConfiguredKey({
        provider: "anthropic",
        modelId: "m",
        credential: { apiKeyMasked: "sk-a***xyz" },
      }),
    ).toBe(true);
    expect(hasConfiguredKey({ provider: "anthropic", modelId: "m" })).toBe(false);
    expect(hasConfiguredKey({ provider: "anthropic", modelId: "m", credential: {} })).toBe(false);
  });

  it("a masked env fallback counts too: the server reports it only for a variable that holds a value", () => {
    expect(
      hasConfiguredKey({ provider: "anthropic", modelId: "m", envKeyMasked: "sk-a\u20263456" }),
    ).toBe(true);
    // Stored key absent but the environment behind it: still configured, same as the model card shows.
    expect(
      hasConfiguredKey({
        provider: "anthropic",
        modelId: "m",
        credential: {},
        envKeyMasked: "sk-a\u20263456",
      }),
    ).toBe(true);
  });

  it("envKey alone is merely the NAME of a fallback var (nothing says it is set): never counts", () => {
    const envOnly = { provider: "anthropic", modelId: "m", envKey: "ANTHROPIC_API_KEY" };
    expect(hasConfiguredKey(envOnly)).toBe(false);
  });
});

describe("visibleChatModels", () => {
  const configured = (provider: string, modelId: string): ModelCredentialRowLike => ({
    provider,
    modelId,
    credential: { apiKeyMasked: "sk-***" },
  });
  const keyless = (provider: string, modelId: string): ModelCredentialRowLike => ({
    provider,
    modelId,
  });
  const pool: ModelCredentialRowLike[] = [
    keyless("deepseek", "deepseek-v4"),
    configured("anthropic", "claude-sonnet-4-6"),
    keyless("anthropic", "claude-opus-4-8"),
    configured("moonshot", "kimi-k2.6"),
    keyless("custom", "my-proxy"),
  ];

  it("by default lists only key-configured models, in library order", () => {
    expect(visibleChatModels(pool, { showAll: false, query: "" }).map((m) => m.modelId)).toEqual([
      "claude-sonnet-4-6",
      "kimi-k2.6",
    ]);
  });

  it("an env-backed model is listed like a stored-key one, not hidden behind show-all", () => {
    const envBacked: ModelCredentialRowLike = {
      provider: "anthropic",
      modelId: "claude-opus-4-8",
      envKeyMasked: "sk-a\u20263456",
    };
    const withEnv = [...pool.filter((m) => m.modelId !== "claude-opus-4-8"), envBacked];
    expect(visibleChatModels(withEnv, { showAll: false, query: "" }).map((m) => m.modelId)).toEqual(
      [
        "claude-sonnet-4-6",
        "claude-opus-4-8", // env fallback only — still counts as having a key
        "kimi-k2.6",
      ],
    );
    // The "show models without key" expander counts only the two genuinely key-less rows.
    expect(
      visibleChatModels(withEnv, { showAll: true, query: "" }).length -
        visibleChatModels(withEnv, { showAll: false, query: "" }).length,
    ).toBe(2);
    // Knowing the variable's NAME is not knowing it is set: such a row stays hidden.
    const nameOnly = {
      provider: "anthropic",
      modelId: "claude-opus-4-8",
      envKey: "ANTHROPIC_API_KEY",
    };
    const withNameOnly = [...pool.filter((m) => m.modelId !== "claude-opus-4-8"), nameOnly];
    expect(
      visibleChatModels(withNameOnly, { showAll: false, query: "" }).map((m) => m.modelId),
    ).toEqual(["claude-sonnet-4-6", "kimi-k2.6"]);
  });

  it("showAll lists everything, still in library order", () => {
    expect(visibleChatModels(pool, { showAll: true, query: "" }).map((m) => m.modelId)).toEqual([
      "deepseek-v4",
      "claude-sonnet-4-6",
      "claude-opus-4-8",
      "kimi-k2.6",
      "my-proxy",
    ]);
  });

  it("the selected and the default model stay visible even without a key", () => {
    const visible = visibleChatModels(pool, {
      showAll: false,
      query: "",
      selected: { provider: "anthropic", modelId: "claude-opus-4-8" },
      defaultModel: { provider: "deepseek", modelId: "deepseek-v4" },
    });
    expect(visible.map((m) => m.modelId)).toEqual([
      "deepseek-v4", // default, key-less — kept
      "claude-sonnet-4-6",
      "claude-opus-4-8", // selected, key-less — kept
      "kimi-k2.6",
    ]);
  });

  it("when no model has a configured key, everything is listed (never an empty dropdown)", () => {
    const none = [keyless("anthropic", "a"), keyless("moonshot", "b")];
    expect(visibleChatModels(none, { showAll: false, query: "" }).map((m) => m.modelId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("the query filters what's visible: hidden key-less models only match once showAll", () => {
    expect(visibleChatModels(pool, { showAll: false, query: "opus" })).toEqual([]);
    expect(visibleChatModels(pool, { showAll: true, query: "opus" }).map((m) => m.modelId)).toEqual(
      ["claude-opus-4-8"],
    );
    // The query also narrows the configured-only view.
    expect(
      visibleChatModels(pool, { showAll: false, query: "kimi" }).map((m) => m.modelId),
    ).toEqual(["kimi-k2.6"]);
    // ...and a key-less selected model kept by the exception is still searchable.
    expect(
      visibleChatModels(pool, {
        showAll: false,
        query: "opus",
        selected: { provider: "anthropic", modelId: "claude-opus-4-8" },
      }).map((m) => m.modelId),
    ).toEqual(["claude-opus-4-8"]);
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

describe("isFreeModel", () => {
  it("numeric buckets (the DTO shape): free ⇔ pricing exists and all three buckets are 0", () => {
    expect(isFreeModel({ cacheRead: 0, cacheWrite: 0, output: 0 })).toBe(true);
    expect(isFreeModel({ cacheRead: 0, cacheWrite: 0, output: 1.2 })).toBe(false);
    expect(isFreeModel({ cacheRead: 0.5, cacheWrite: 6.25, output: 25 })).toBe(false);
    // No pricing at all = costs merely unknown, not free.
    expect(isFreeModel(undefined)).toBe(false);
  });

  it('string-typed edit fields (the model page\'s RowState shape): "" means unpriced, not $0', () => {
    expect(isFreeModel({ cacheRead: "0", cacheWrite: "0", output: "0" })).toBe(true);
    expect(isFreeModel({ cacheRead: "", cacheWrite: "", output: "" })).toBe(false);
    // Partially filled pricing never counts as free.
    expect(isFreeModel({ cacheRead: "0", cacheWrite: "", output: "0" })).toBe(false);
    expect(isFreeModel({ cacheRead: "0", cacheWrite: "0", output: "3" })).toBe(false);
  });
});
describe("discountedPrice", () => {
  /**
   * A row carrying what the catalog hands a Project: its list price (the peak one for a scheduled
   * entry) and no promotion. The promotion is the server's to report, so each case adds its own.
   */
  const presetRow = (provider: string, modelId: string) => {
    const pricing = catalogEntryFor(provider, modelId)!.pricing!;
    return {
      provider,
      modelId,
      cacheRead: String(pricing.cache_read),
      cacheWrite: String(pricing.cache_write),
      output: String(pricing.output),
    };
  };

  // Beijing is UTC+8, so 01:00Z is 09:00 there. 2026-08-31 is a Monday.
  const PEAK = new Date("2026-08-31T01:30:00Z");
  const OFF_PEAK = new Date("2026-08-31T05:00:00Z");

  it("a promotion takes its rate off the stored list price, on any row", () => {
    // Off the catalog on purpose: the promotion is the row's own, as a platform sync reports it
    // for a model the built-in catalog has never heard of.
    const row = {
      provider: "penguin-go",
      modelId: "gemini-future",
      cacheRead: "0.1",
      cacheWrite: "0.5",
      output: "2",
      discount: 0.5,
    };
    expect(discountedPrice(row)).toEqual({
      percent: 50,
      billed: { cacheRead: 0.05, cacheWrite: 0.25, output: 1 },
    });
    // No price check of its own: the server clears a promotion whose price a save changes.
    expect(discountedPrice({ ...row, output: "4" })?.billed.output).toBe(2);
  });

  it("reads the promotion off the row, never off the catalog entry", () => {
    const promoted = MODEL_CATALOG.find(
      (e) =>
        e.pricing !== undefined &&
        e.offPeakDiscount === undefined &&
        e.discount !== undefined &&
        e.discount > 0 &&
        e.discount < 1,
    )!;
    const row = presetRow(promoted.provider, promoted.modelId);
    expect(discountedPrice(row)).toBeUndefined();
    expect(discountedPrice({ ...row, discount: promoted.discount })?.percent).toBe(
      Math.round(promoted.discount! * 100),
    );
    // A file still holding the promotional price itself, with nothing reported beside it, is
    // billed at that number and says nothing about a saving.
    const effective = effectivePricing(promoted)!;
    expect(
      discountedPrice({
        ...row,
        cacheRead: String(effective.cache_read),
        cacheWrite: String(effective.cache_write),
        output: String(effective.output),
      }),
    ).toBeUndefined();
  });

  it("a scheduled row is marked and halved off-peak, and left at list price at peak", () => {
    const row = presetRow("deepseek", "deepseek-flash");
    const entry = catalogEntryFor("deepseek", "deepseek-flash")!;

    const off = discountedPrice(row, OFF_PEAK)!;
    expect(off.percent).toBe(50);
    expect(off.peak).toEqual(peakWindows(DEEPSEEK_OFF_PEAK));
    expect(off.billed.output).toBeCloseTo(entry.pricing!.output / 2, 6);

    // At peak the row carries no mark at all: the stored price is the price.
    expect(discountedPrice(row, PEAK)).toBeUndefined();
  });

  it("each scheduled row follows its own seller's windows, and the badge's title names them", () => {
    // Qwen bills the DeepSeek models it sells at peak 08:00-22:00 Beijing on every day, while
    // DeepSeek's own peak is weekday office hours: a Saturday morning parts the two.
    const saturdayMorning = new Date("2026-09-05T02:00:00Z"); // 10:00 Beijing
    const lateEvening = new Date("2026-08-31T15:00:00Z"); // Monday 23:00 Beijing
    const qwen = presetRow("qwen-pay-as-you-go", "deepseek-v4.1-flash");
    const deepseek = presetRow("deepseek", "deepseek-flash");
    expect(discountedPrice(qwen, saturdayMorning)).toBeUndefined();
    expect(discountedPrice(deepseek, saturdayMorning)?.peak).toEqual(
      peakWindows(DEEPSEEK_OFF_PEAK),
    );
    const qwenOff = discountedPrice(qwen, lateEvening)!;
    expect(qwenOff.percent).toBe(50);
    expect(qwenOff.peak).toEqual({
      days: [[1, 7]],
      everyDay: true,
      hours: [[8, 22]],
    });

    expect(peakWindows(DEEPSEEK_OFF_PEAK)).toEqual({
      days: [[1, 5]],
      everyDay: false,
      hours: [
        [9, 12],
        [14, 18],
      ],
    });
    // The hover text is spelled from the schedule in both dictionaries, so neither vendor's
    // windows are described with the other's.
    expect(zh.models.offPeakTitle(50, peakWindows(DEEPSEEK_OFF_PEAK))).toBe(
      "空闲时段价：比牌价低 50%。高峰时段按牌价计费——北京时间周一至周五 9:00–12:00、14:00–18:00",
    );
    expect(en.models.offPeakTitle(50, peakWindows(DEEPSEEK_OFF_PEAK))).toBe(
      "Off-peak rate: 50% off list. Peak hours bill at list price — 09:00–12:00 and 14:00–18:00 Beijing time, Monday to Friday",
    );
    expect(zh.models.offPeakTitle(50, peakWindows(QWEN_OFF_PEAK))).toBe(
      "空闲时段价：比牌价低 50%。高峰时段按牌价计费——北京时间每天 8:00–22:00",
    );
    expect(en.models.offPeakTitle(50, peakWindows(QWEN_OFF_PEAK))).toBe(
      "Off-peak rate: 50% off list. Peak hours bill at list price — 08:00–22:00 Beijing time, every day",
    );
  });

  it("a promotion on a scheduled row multiplies with the live off-peak tier", () => {
    const row = { ...presetRow("deepseek", "deepseek-flash"), discount: 0.2 };
    const output = catalogEntryFor("deepseek", "deepseek-flash")!.pricing!.output;

    // 20% off, then half of the rest: 60% off, explained as the promotion.
    const off = discountedPrice(row, OFF_PEAK)!;
    expect(off.percent).toBe(60);
    expect(off.peak).toBeUndefined();
    expect(off.billed.output).toBeCloseTo(output * 0.8 * 0.5, 5);

    const peak = discountedPrice(row, PEAK)!;
    expect(peak.percent).toBe(20);
    expect(peak.billed.output).toBeCloseTo(output * 0.8, 5);
  });

  it("a scheduled row whose price was edited is never halved, though a promotion still applies", () => {
    const row = { ...presetRow("deepseek", "deepseek-v4-pro"), output: "1.234" };
    expect(discountedPrice(row, OFF_PEAK)).toBeUndefined();
    expect(discountedPrice(row, PEAK)).toBeUndefined();
    expect(discountedPrice({ ...row, discount: 0.2 }, OFF_PEAK)).toEqual({
      percent: 20,
      billed: expect.objectContaining({ output: 0.9872 }),
    });
  });

  it("ignores a discount outside (0, 1)", () => {
    const priced = {
      provider: "custom",
      modelId: "my-proxy",
      cacheRead: "1",
      cacheWrite: "2",
      output: "3",
    };
    const scheduled = presetRow("deepseek", "deepseek-v4-flash");
    for (const discount of [0, 1, -0.2, 1.5, Number.NaN]) {
      expect(discountedPrice({ ...priced, discount })).toBeUndefined();
      // Only the tier is left to report.
      expect(discountedPrice({ ...scheduled, discount }, OFF_PEAK)).toMatchObject({
        percent: 50,
        peak: peakWindows(DEEPSEEK_OFF_PEAK),
      });
    }
  });

  it("rows with nothing to take off, and unpriced rows, report nothing", () => {
    expect(
      discountedPrice({
        provider: "custom",
        modelId: "my-proxy",
        cacheRead: "1",
        cacheWrite: "2",
        output: "3",
      }),
    ).toBeUndefined();
    // A promotion needs a price to come off.
    expect(
      discountedPrice({ provider: "tokendance", modelId: "kimi-k3", discount: 0.2 }),
    ).toBeUndefined();
    expect(
      discountedPrice({
        provider: "tokendance",
        modelId: "kimi-k3",
        cacheRead: "",
        cacheWrite: "",
        output: "",
        discount: 0.2,
      }),
    ).toBeUndefined();
  });

  it("accepts the DTO's numeric buckets as well as the edit form's strings", () => {
    const strings = {
      provider: "custom",
      modelId: "my-proxy",
      cacheRead: "1",
      cacheWrite: "2",
      output: "3",
      discount: 0.1,
    };
    expect(discountedPrice(strings)?.percent).toBe(10);
    expect(discountedPrice({ ...strings, cacheRead: 1, cacheWrite: 2, output: 3 })?.billed).toEqual(
      { cacheRead: 0.9, cacheWrite: 1.8, output: 2.7 },
    );
  });
});

describe("promotedPricing", () => {
  it("takes a running promotion off every bucket, and leaves a price without one as it is", () => {
    const list = { cacheRead: 0.5, cacheWrite: 2, output: 8 };
    expect(promotedPricing(list, 0.25)).toEqual({ cacheRead: 0.375, cacheWrite: 1.5, output: 6 });
    expect(promotedPricing(list, undefined)).toBe(list);
    expect(promotedPricing(list, 1)).toBe(list);
    expect(promotedPricing(undefined, 0.25)).toBeUndefined();
  });
});
