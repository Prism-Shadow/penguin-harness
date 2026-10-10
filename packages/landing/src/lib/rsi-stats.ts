/**
 * What the hero's two derived counts count: the RSI toolkits (the plugins of the library's `rsi`
 * category, in the order the stat tile names them) and the built-in Benchmark reproductions.
 * test/rsi-stats.test.ts pins both lists to their sources in the monorepo, so a toolkit or a
 * built-in Benchmark cannot ship while the landing page prints the old count.
 */
export const RSI_TOOLKITS = ["rsi-default", "rsi-opro", "rsi-ape", "rsi-ace", "rsi-awm"] as const;

export const BENCHMARK_REPRODUCTIONS = [
  "penguinharness-benchmark-sec-a",
  "penguinharness-benchmark-sec-b",
  "penguinharness-benchmark-sec-c",
  "penguinharness-benchmark-sec-d",
  "penguinharness-benchmark-sec-e",
] as const;
