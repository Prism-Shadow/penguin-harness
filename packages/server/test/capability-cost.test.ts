/**
 * Given media rates of different units, a reader can price normalised usage without charging the
 * same image twice. Missing quantities and unknown rates stay unpriced. Project rates can change
 * the estimate for a recorded request without altering its stored measurements.
 */
import { describe, expect, it } from "vitest";
import { estimateToolCost } from "../src/services/capability-cost.js";

const run = {
  createdAt: "2026-11-19T02:00:00Z",
  capability: "image",
  model: { provider: "google", modelId: "gemini-3.1-flash-image" },
  usage: { cached_tokens: null, prompt_tokens: 100, thoughts_tokens: 20, response_tokens: 1120 },
  measurements: [{ unit: "image", quantity: 1 }],
} satisfies Parameters<typeof estimateToolCost>[0];

describe("image cost estimates", () => {
  it("prices mixed response output at the image rate and separates reported thinking", () => {
    expect(estimateToolCost(run)).toEqual({ minimumUsd: 0.06731, maximumUsd: 0.06731 });
  });
  it("uses the published cache rate once, without adding hits to uncached input", () => {
    const estimate = estimateToolCost({
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
    expect(estimateToolCost(result)).toEqual({ minimumUsd: 0.036, maximumUsd: 0.036 });
    expect(
      estimateToolCost({
        ...result,
        model: { provider: "tokendance", modelId: "seedream-5.0-lite" },
      })?.maximumUsd,
    ).toBeCloseTo(0.44 / 7, 12);
    expect(estimateToolCost({ ...result, measurements: [] })).toBeNull();
    expect(
      estimateToolCost({
        ...result,
        model: { provider: "openrouter", modelId: "bytedance-seed/seedream-5-5" },
      }),
    ).toEqual({ minimumUsd: 0.04, maximumUsd: 0.07 });
  });
  it("prices reported buckets and keeps absent usage, unpriced hits and unknown models unpriced", () => {
    expect(
      estimateToolCost({ ...run, usage: { ...run.usage, prompt_tokens: null } })?.minimumUsd,
    ).toBeCloseTo(0.06726, 12);
    expect(estimateToolCost({ ...run, usage: null })).toBeNull();
    expect(estimateToolCost({ ...run, usage: { ...run.usage, cached_tokens: 3 } })).toBeNull();
    expect(
      estimateToolCost({ ...run, model: { provider: "mine", modelId: run.model.modelId } }),
    ).toBeNull();
  });
  it("can reprice an unchanged record at a project rate, including a real free tier", () => {
    const model = { provider: "mine", modelId: "my-image" };
    const record = { ...run, model };
    const rate = { unit: "usd_per_mtok", cache_read: 0, cache_write: 1, output: 10 } as const;
    expect(estimateToolCost(record, rate)?.minimumUsd).toBeCloseTo(0.0115, 12);
    expect(estimateToolCost(record, { ...rate, cache_write: 0, output: 0 })).toEqual({
      minimumUsd: 0,
      maximumUsd: 0,
    });
  });
});

describe("read-time MMSP tool prices", () => {
  const request = (
    capability: typeof run.capability | "tts" | "stt" | "search" | "fetch" | "video" | "t2t",
    provider: string,
    modelId: string,
  ) => ({
    ...run,
    capability,
    model: { provider, modelId },
  });
  it("prices the same four billed ASR seconds once, using the selected seller and currency", () => {
    const seconds = { unit: "billed_audio_second", quantity: 4 } as const;
    for (const [seller, dollars] of [
      ["tokendance", 0.0004 / 7],
      ["deepseek", (4 * 0.058) / 3600],
      ["openrouter", 4 * 0.0001],
    ] as const) {
      const model = seller === "openrouter" ? "fish-audio/transcribe-1" : "deepseek-asr";
      const asr = {
        ...request("stt", seller, model),
        usage: {
          cached_tokens: null,
          prompt_tokens: 4,
          thoughts_tokens: null,
          response_tokens: null,
        },
      };
      expect(estimateToolCost({ ...asr, inputMeter: seconds })?.minimumUsd).toBeCloseTo(
        dollars,
        14,
      );
      expect(estimateToolCost({ ...asr, inputMeter: { unit: "token", quantity: 4 } })).toBeNull();
    }
  });
  it("uses the provider's character and byte counts for speech", () => {
    expect(
      estimateToolCost({
        ...request("tts", "deepseek", "deepseek-tts"),
        inputMeter: { unit: "billed_character", quantity: 3 },
      })?.minimumUsd,
    ).toBeCloseTo((3 * 0.225) / 10000, 14);
    expect(
      estimateToolCost({
        ...request("tts", "openrouter", "fish-audio/drama-3"),
        inputMeter: { unit: "utf8_byte", quantity: 4 },
      })?.minimumUsd,
    ).toBeCloseTo((4 * 10) / 1e6, 14);
  });
  it.each(["search", "fetch"] as const)(
    "distinguishes %s success tariffs from gateway request pricing and Jina tokens",
    (op) => {
      const official = request(op, "deepseek", "deepseek-" + op);
      const gateway = request(op, "tokendance", "deepseek-" + op);
      for (const quantity of [0, 1, 3]) {
        expect(
          estimateToolCost({ ...official, inputMeter: { unit: "billable_request", quantity } })
            ?.minimumUsd,
        ).toBe((quantity * 0.75) / 1000);
      }
      expect(
        estimateToolCost({ ...gateway, measurements: [{ unit: "request", quantity: 2 }] })
          ?.minimumUsd,
      ).toBeCloseTo((2 * 0.005) / 7, 14);
      const jina = {
        ...request(op, "jina", "jina-" + op),
        usage: {
          prompt_tokens: 2000,
          thoughts_tokens: null,
          response_tokens: null,
          cached_tokens: null,
        },
      };
      expect(estimateToolCost(jina)?.minimumUsd).toBeCloseTo(0.0001, 14);
      expect(
        estimateToolCost({ ...jina, model: { ...jina.model, provider: "custom" } }),
      ).toBeNull();
    },
  );
  it("applies the promotional audio rate only to runs before it expires", () => {
    const audio = {
      ...request("tts", "google", "gemini-3.8-flash-tts"),
      usage: {
        prompt_tokens: 100,
        response_tokens: 200,
        cached_tokens: null,
        thoughts_tokens: null,
      },
    };
    expect(estimateToolCost(audio)?.minimumUsd).toBeCloseTo(0.00185, 14);
    expect(
      estimateToolCost({ ...audio, createdAt: "2027-01-01T00:00:00Z" })?.minimumUsd,
    ).toBeCloseTo(0.0037, 14);
  });
  it("prices Gemini Omni's thinking as text and its response as video", () => {
    expect(
      estimateToolCost(request("video", "google", "gemini-omni-1.2-flash"))?.minimumUsd,
    ).toBeCloseTo((100 * 1.5 + 20 * 9 + 1120 * 12) / 1e6, 14);
  });
  it("prices four reported remote buckets with an explicit project rate and keeps all-null unknown", () => {
    const custom = {
      ...request("t2t", "custom", "my-server"),
      usage: { cached_tokens: 10, prompt_tokens: 20, thoughts_tokens: 30, response_tokens: 40 },
    };
    const rate = { unit: "usd_per_mtok", cache_read: 1, cache_write: 2, output: 3 } as const;
    expect(estimateToolCost(custom, rate)?.minimumUsd).toBeCloseTo(0.00026, 14);
    expect(
      estimateToolCost(
        {
          ...custom,
          usage: {
            cached_tokens: null,
            prompt_tokens: null,
            thoughts_tokens: null,
            response_tokens: null,
          },
        },
        rate,
      ),
    ).toBeNull();
    expect(
      estimateToolCost(
        {
          ...custom,
          usage: {
            cached_tokens: null,
            prompt_tokens: 0,
            thoughts_tokens: null,
            response_tokens: null,
          },
        },
        rate,
      )?.minimumUsd,
    ).toBe(0);
  });
});
