/**
 * Given media rates of different units, a reader can price normalised usage without charging the
 * same image twice. Missing quantities and unknown rates stay unpriced. Project rates can change
 * the estimate for a recorded request without altering its stored measurements.
 */
import { describe, expect, it } from "vitest";
import { estimateImageToolCost } from "../src/services/capability-cost.js";

const run = {
  capability: "image",
  model: { provider: "google", modelId: "gemini-3.1-flash-image" },
  usage: { cached_tokens: null, prompt_tokens: 100, thoughts_tokens: 20, response_tokens: 1120 },
  measurements: [{ unit: "image", quantity: 1 }],
} satisfies Parameters<typeof estimateImageToolCost>[0];

describe("image cost estimates", () => {
  it("prices mixed response output at the image rate and separates reported thinking", () => {
    expect(estimateImageToolCost(run)).toEqual({ minimumUsd: 0.06731, maximumUsd: 0.06731 });
  });
  it("uses the published cache rate once, without adding hits to uncached input", () => {
    const estimate = estimateImageToolCost({
      ...run,
      model: { provider: "openai", modelId: "gpt-image-2.5-flare" },
      usage: {
        cached_tokens: 100,
        prompt_tokens: 900,
        thoughts_tokens: null,
        response_tokens: 1000,
      },
    });
    expect(estimate?.minimumUsd).toBeCloseTo(0.034625, 12);
  });
  it("uses the actual image count regardless of resolution or reported tokens", () => {
    const result = {
      ...run,
      model: { provider: "openrouter", modelId: "bytedance-seed/seedream-5-0-flash" },
      usage: null,
      measurements: [{ unit: "image", quantity: 2 }],
    };
    expect(estimateImageToolCost(result)).toEqual({ minimumUsd: 0.036, maximumUsd: 0.036 });
    expect(
      estimateImageToolCost({
        ...result,
        model: { provider: "tokendance", modelId: "seedream-5.0-lite" },
      })?.maximumUsd,
    ).toBeCloseTo(0.44 / 7, 12);
    expect(estimateImageToolCost({ ...result, measurements: [] })).toBeNull();
    expect(
      estimateImageToolCost({
        ...result,
        model: { provider: "openrouter", modelId: "bytedance-seed/seedream-5-5" },
      }),
    ).toEqual({ minimumUsd: 0.04, maximumUsd: 0.07 });
  });
  it("reports missing paid input, unpriced cache hits and unknown models as unpriced", () => {
    expect(
      estimateImageToolCost({ ...run, usage: { ...run.usage, prompt_tokens: null } }),
    ).toBeNull();
    expect(estimateImageToolCost({ ...run, usage: { ...run.usage, cached_tokens: 3 } })).toBeNull();
    expect(
      estimateImageToolCost({ ...run, model: { provider: "mine", modelId: run.model.modelId } }),
    ).toBeNull();
    expect(estimateImageToolCost({ ...run, capability: "tts" })).toBeNull();
  });
  it("can reprice an unchanged record at a project rate, including a real free tier", () => {
    const model = { provider: "mine", modelId: "my-image" };
    const record = { ...run, model };
    const rate = { unit: "usd_per_mtok", cache_read: 0, cache_write: 1, output: 10 } as const;
    expect(estimateImageToolCost(record, rate)?.minimumUsd).toBeCloseTo(0.0115, 12);
    expect(estimateImageToolCost(record, { ...rate, cache_write: 0, output: 0 })).toEqual({
      minimumUsd: 0,
      maximumUsd: 0,
    });
  });
});
