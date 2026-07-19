import { describe, expect, it } from "vitest";
import {
  CODE_BENCH,
  DATA_BENCH,
  formatAccuracy,
  formatPct,
  formatTokensM,
  formatUsd,
} from "../src/lib/benchmark-data";

describe("benchmark data (unified per-run means)", () => {
  it("formats the data-analysis suite at its published precision", () => {
    const penguin = DATA_BENCH[0]!;
    expect(formatPct(penguin.accuracyPct)).toBe("66.7%");
    expect(formatAccuracy(penguin.accuracyPct, 1)).toBe("66.7");
    expect(formatTokensM(penguin.tokensM, 2)).toBe("18.04M");
    expect(formatUsd(penguin.costUsd, 3)).toBe("$0.552");
  });

  it("formats the coding suite at its published precision (CNY converted at 7:1)", () => {
    const penguin = CODE_BENCH[0]!;
    expect(formatAccuracy(penguin.accuracyPct, 2)).toBe("50.00");
    expect(formatTokensM(penguin.tokensM, 2)).toBe("2.10M");
    expect(formatUsd(penguin.costUsd, 3)).toBe("$0.041");
    // 0.289 CNY / 7 -> ~0.0413 USD
    expect(penguin.costUsd).toBeCloseTo(0.289 / 7, 3);
  });

  it("uses the unified framework names with PenguinHarness as the only emphasized row", () => {
    for (const suite of [DATA_BENCH, CODE_BENCH]) {
      expect(suite.map((r) => r.framework)).toEqual([
        "PenguinHarness",
        "Claude Code",
        "OpenAI Codex",
      ]);
      expect(suite.filter((r) => r.emphasized).map((r) => r.framework)).toEqual(["PenguinHarness"]);
      for (const row of suite) expect(row.model).toBe("DeepSeek V4 Pro");
    }
  });
});
