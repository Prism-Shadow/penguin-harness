/**
 * Benchmark data, two suites published in one unified shape: framework / model /
 * accuracy (%) / Tokens (M) / cost ($).
 *
 * Each harness runs the model it is normally paired with rather than a shared one —
 * the comparison is between products as people actually use them, so the model column
 * is part of the result and not a constant. Token and cost figures are **suite totals**
 * across every task and run, not per-run means. Suite specifics (case count, runs,
 * thinking level, pricing source) live in the footnote strings, not in the table.
 * - Data analysis: 15 tasks, single run.
 * - Coding: 40 tasks x 2 runs (accuracy is over all 80 outcomes).
 */
import type { HarnessKind } from "../components/harness-logo";

export interface BenchResult {
  kind: HarnessKind;
  framework: string;
  model: string;
  accuracyPct: number;
  tokensM: number;
  costUsd: number;
  /** The series the story is about (emphasis form: accent hue vs de-emphasis gray). */
  emphasized?: boolean;
}

const DEEPSEEK = "DeepSeek V4 Pro";
const OPUS = "Claude Opus 4.8";
const GPT = "GPT-5.5";

export const DATA_BENCH: BenchResult[] = [
  {
    kind: "penguin",
    framework: "PenguinHarness",
    model: DEEPSEEK,
    accuracyPct: 66.67,
    tokensM: 18.037757,
    costUsd: 0.552406,
    emphasized: true,
  },
  {
    kind: "claude",
    framework: "Claude Code",
    model: OPUS,
    accuracyPct: 53.33,
    tokensM: 22.197759,
    costUsd: 38.479975,
  },
  {
    kind: "codex",
    framework: "OpenAI Codex",
    model: GPT,
    accuracyPct: 53.33,
    tokensM: 13.72473,
    costUsd: 19.413715,
  },
];

export const CODE_BENCH: BenchResult[] = [
  {
    kind: "penguin",
    framework: "PenguinHarness",
    model: DEEPSEEK,
    accuracyPct: 71.25,
    tokensM: 200.0,
    costUsd: 3.812,
    emphasized: true,
  },
  {
    kind: "claude",
    framework: "Claude Code",
    model: OPUS,
    accuracyPct: 86.25,
    tokensM: 151.61,
    costUsd: 146.97,
  },
  {
    kind: "codex",
    framework: "OpenAI Codex",
    model: GPT,
    accuracyPct: 71.25,
    tokensM: 251.2,
    costUsd: 220.08,
  },
];

/** 66.67 -> "66.67%" (chart caps). */
export function formatPct(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

/** Table accuracy; both suites publish at 2dp (10/15 -> 66.67, 57/80 -> 71.25). */
export function formatAccuracy(pct: number, dp: number): string {
  return pct.toFixed(dp);
}

/** 18.037757 -> "18.04M" / 200 -> "200.00M". */
export function formatTokensM(tokens: number, dp = 2): string {
  return `${tokens.toFixed(dp)}M`;
}

/** Chart cost caps: $0.55 vs $220.08 — one format across a three-order-of-magnitude spread. */
export function formatUsd(cost: number, dp = 2): string {
  return `$${cost.toFixed(dp)}`;
}

/**
 * How many times more a rival spent for the same suite ($38.48 vs $0.55 -> 70). The
 * headline claim is built from the data rather than typed into the copy, so it cannot
 * drift when the numbers are refreshed.
 */
export function costMultiple(rival: BenchResult, ours: BenchResult): number {
  return Math.round(rival.costUsd / ours.costUsd);
}
