/**
 * What a round's readings panel lists (features/traces/round-readings.tsx, `roundReadingRows`):
 * the figures the round's row no longer prints, a click on its ring away.
 *
 * - A round with a context snapshot lists its own throughput — input, cache hits with their
 *   rate, output, output speed — then the snapshot against the window and its three segments.
 * - A pure compaction round has no snapshot: the throughput alone, and no usage.
 * - A round with no input reads its hit rate as a dash, never as a rate of nothing.
 */
import { describe, expect, it } from "vitest";
import { roundReadingRows } from "../src/features/traces/round-readings";
import { S } from "../src/lib/strings";

const TOKENS = { cacheRead: 30_000, cacheWrite: 2_000, output: 1_234 };

describe("a round's readings", () => {
  it("lists the round's throughput, then the context snapshot against the window", () => {
    const r = roundReadingRows(TOKENS, 12_000, TOKENS, 200_000);

    expect(r.round).toEqual([
      { label: S.traces.taskInput, value: "32k" },
      { label: S.traces.taskCacheHit, value: "30k · 94%" },
      { label: S.traces.taskOutput, value: "1.2k" },
      { label: S.chat.statTps, value: "102.8 tok/s" },
    ]);
    expect(r.context).toEqual([
      { label: S.chat.contextUsage, value: "33.2k / 200k · 17%" },
      { label: S.usage.colCacheRead, value: "30k" },
      { label: S.usage.colCacheWrite, value: "2k" },
      { label: S.usage.colOutput, value: "1.2k" },
    ]);
  });

  it("a compaction round with no snapshot lists its throughput alone", () => {
    const r = roundReadingRows(TOKENS, 12_000, undefined, 200_000);
    expect(r.round.map((row) => row.label)).toEqual([
      S.traces.taskInput,
      S.traces.taskCacheHit,
      S.traces.taskOutput,
      S.chat.statTps,
    ]);
    expect(r.context).toBeNull();
    expect(r.usage).toBeNull();
  });

  it("a round with no input reads its hit rate as a dash", () => {
    const r = roundReadingRows({ cacheRead: 0, cacheWrite: 0, output: 0 }, 0, null, 128_000);
    expect(r.round[1]!.value).toBe("0 · —");
    expect(r.round[3]!.value).toBe("—");
  });
});
