import { describe, expect, it } from "vitest";
import {
  CODE_BENCH,
  DATA_BENCH,
  costMultiple,
  formatAccuracy,
  formatPct,
  formatTokensM,
  formatUsd,
} from "../src/lib/benchmark-data";

describe("benchmark data (unified suite totals)", () => {
  it("formats the data-analysis suite at its published precision", () => {
    const penguin = DATA_BENCH[0]!;
    expect(formatPct(penguin.accuracyPct)).toBe("66.67%");
    expect(formatAccuracy(penguin.accuracyPct, 2)).toBe("66.67");
    expect(formatTokensM(penguin.tokensM, 2)).toBe("18.04M");
    expect(formatUsd(penguin.costUsd, 2)).toBe("$0.55");
  });

  it("formats the coding suite at its published precision", () => {
    const penguin = CODE_BENCH[0]!;
    expect(formatAccuracy(penguin.accuracyPct, 2)).toBe("71.25");
    expect(formatTokensM(penguin.tokensM, 2)).toBe("200.00M");
    expect(formatUsd(penguin.costUsd, 2)).toBe("$3.81");
  });

  it("keeps every published accuracy on its suite's grid (n=15 and n=80)", () => {
    // 10/15 -> 66.67, 8/15 -> 53.33; 57/80 -> 71.25, 69/80 -> 86.25. A number off the grid
    // means a transcription slip, which the charts would render without complaint.
    for (const row of DATA_BENCH)
      expect(Math.round((row.accuracyPct / 100) * 15)).toBeCloseTo((row.accuracyPct / 100) * 15, 1);
    for (const row of CODE_BENCH) expect(((row.accuracyPct / 100) * 80) % 1).toBeCloseTo(0, 6);
  });

  it("backs the copy's cost claims: 35x/70x on data analysis, 58x/39x on coding", () => {
    const [dPenguin, dClaude, dCodex] = DATA_BENCH as [
      (typeof DATA_BENCH)[0],
      (typeof DATA_BENCH)[0],
      (typeof DATA_BENCH)[0],
    ];
    expect(costMultiple(dCodex, dPenguin)).toBe(35);
    expect(costMultiple(dClaude, dPenguin)).toBe(70);
    const [cPenguin, cClaude, cCodex] = CODE_BENCH as [
      (typeof CODE_BENCH)[0],
      (typeof CODE_BENCH)[0],
      (typeof CODE_BENCH)[0],
    ];
    expect(costMultiple(cCodex, cPenguin)).toBe(58);
    expect(costMultiple(cClaude, cPenguin)).toBe(39);
  });

  it("pairs each harness with its own model and emphasizes only PenguinHarness", () => {
    for (const suite of [DATA_BENCH, CODE_BENCH]) {
      expect(suite.map((r) => r.framework)).toEqual([
        "PenguinHarness",
        "Claude Code",
        "OpenAI Codex",
      ]);
      expect(suite.filter((r) => r.emphasized).map((r) => r.framework)).toEqual(["PenguinHarness"]);
      expect(suite.map((r) => r.model)).toEqual(["DeepSeek V4 Pro", "Claude Opus 4.8", "GPT-5.5"]);
    }
  });
});
