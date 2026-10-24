/**
 * What a round's readings panel lists (features/traces/round-readings.tsx, `roundReadingRows`):
 * the figures the round's row no longer prints, a click on its ring away, each once.
 *
 * - A round with a context snapshot lists its input, cache hits with their rate, cache misses,
 *   output and output speed, then its context usage against the window.
 * - A pure compaction round has no snapshot: no context usage row, and no usage.
 * - A round with no input reads its hit rate as a dash, never as a rate of nothing.
 */
import { describe, expect, it } from "vitest";
import { roundReadingRows } from "../src/features/traces/round-readings";
import { S } from "../src/lib/strings";

const TOKENS = { cacheRead: 30_000, cacheWrite: 2_000, output: 1_234 };

describe("a round's readings", () => {
  it("lists each figure once: the round's throughput, then the context usage", () => {
    const r = roundReadingRows(TOKENS, 12_000, TOKENS, 200_000);

    expect(r.rows).toEqual([
      { label: S.chat.statInput, value: "32k" },
      { label: S.traces.cacheHit, value: "30k · 94%" },
      { label: S.traces.cacheMiss, value: "2k" },
      { label: S.chat.statOutput, value: "1.2k" },
      { label: S.chat.statTps, value: "102.8 tok/s" },
      { label: S.chat.contextUsage, value: "33.2k / 200k · 17%" },
    ]);
  });

  it("a compaction round with no snapshot has no context usage", () => {
    const r = roundReadingRows(TOKENS, 12_000, undefined, 200_000);
    expect(r.rows.map((row) => row.label)).not.toContain(S.chat.contextUsage);
    expect(r.rows).toHaveLength(5);
    expect(r.usage).toBeNull();
  });

  it("a round with no input reads its hit rate as a dash", () => {
    const r = roundReadingRows({ cacheRead: 0, cacheWrite: 0, output: 0 }, 0, null, 128_000);
    expect(r.rows[1]!.value).toBe("0 · —");
    expect(r.rows[4]!.value).toBe("—");
  });
});
