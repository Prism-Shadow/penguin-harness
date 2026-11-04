/**
 * How the benchmark section prints its figures (src/lib/benchmark-data.ts).
 *
 * - Given an accuracy, a Token total or a cost, it prints at the asked precision with its unit:
 *   `%` after an accuracy cap, `M` after Tokens, `$` before a cost.
 * - Given a rival's cost and ours, the headline multiple is the ratio rounded to a whole number.
 */
import { describe, expect, it } from "vitest";
import type { BenchResult } from "../src/lib/benchmark-data";
import {
  costMultiple,
  formatAccuracy,
  formatPct,
  formatTokensM,
  formatUsd,
} from "../src/lib/benchmark-data";

const run = (costUsd: number): BenchResult => ({
  kind: "penguin",
  framework: "A harness",
  model: "A model",
  accuracyPct: 50,
  tokensM: 1,
  costUsd,
});

describe("benchmark figures", () => {
  it("print at the asked precision, each with its unit", () => {
    expect(formatPct(66.666)).toBe("66.67%");
    expect(formatAccuracy(71.25, 1)).toBe("71.3");
    expect(formatTokensM(18.037757)).toBe("18.04M");
    expect(formatTokensM(200, 0)).toBe("200M");
    expect(formatUsd(0.552406)).toBe("$0.55");
    expect(formatUsd(146.97, 0)).toBe("$147");
  });

  it("state a rival's cost as a whole multiple of ours", () => {
    expect(costMultiple(run(38.48), run(0.55))).toBe(70);
    expect(costMultiple(run(1.24), run(1))).toBe(1);
  });
});
