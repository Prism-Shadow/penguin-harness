import { afterEach, describe, expect, it } from "vitest";
import { toolModelQuote } from "../src/lib/tool-model-price";
import { pickerRowTags } from "../src/features/model-picker/model-picker-logic";
import { en } from "../src/lib/strings-en";
import { setActiveStrings, zh } from "../src/lib/strings";

afterEach(() => setActiveStrings(zh));

describe("provider-native tool prices", () => {
  it("distinguishes two sellers with the same upstream id from an unpriced custom connection", () => {
    setActiveStrings(en);
    const modelId = "deepseek-asr";
    expect(toolModelQuote({ provider: "deepseek", modelId })?.primary).toBe(
      "Offer US$0.058/audio hour (list US$0.116)",
    );
    expect(toolModelQuote({ provider: "tokendance", modelId })?.primary).toBe(
      "Offer ¥0.0001/audio second (list ¥0.0002)",
    );
    const custom = { provider: "custom", modelId, chatEligible: false };
    expect(toolModelQuote(custom)?.published).toBe(false);
    expect(
      pickerRowTags({ ...custom, pricing: { cacheRead: 0, cacheWrite: 0, output: 0 } }, null).some(
        (t) => t.key === "free",
      ),
    ).toBe(false);
    expect(toolModelQuote({ provider: "google", modelId: "gemini-4-carbon" })).toBeUndefined();
  });

  it("uses the active language, lists all input and output rates, and ends a timed offer", () => {
    setActiveStrings(zh);
    const model = { provider: "google", modelId: "gemini-3.8-flash-tts" };
    expect(toolModelQuote(model, new Date("2026-12-31T23:59:59Z"))?.details).toEqual([
      "限时 US$9/百万音频输出 Token（原价 US$18）",
      "限时 US$0.5/百万输入 Token（原价 US$1）",
    ]);
    expect(toolModelQuote(model, new Date("2027-01-01T00:00:00Z"))?.details).toEqual([
      "US$18/百万音频输出 Token",
      "US$1/百万输入 Token",
    ]);
    expect(toolModelQuote({ provider: "tokendance", modelId: "seedream-5.0-lite" })?.primary).toBe(
      "¥0.22/张",
    );
    expect(
      toolModelQuote({ provider: "openrouter", modelId: "bytedance-seed/seedream-5-5" })?.primary,
    ).toBe("US$0.02–US$0.035/张");
    expect(toolModelQuote({ provider: "google", modelId: "gemini-omni-1.2-flash" })?.primary).toBe(
      "US$12/百万视频输出 Token",
    );
    expect(toolModelQuote({ provider: "jina", modelId: "jina-fetch" })?.published).toBe(false);
  });
});
