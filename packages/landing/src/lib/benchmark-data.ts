/**
 * Benchmark data, two suites driven by the same DeepSeek V4 Pro model, published in
 * one unified shape: framework / model / accuracy (%) / Tokens (M) / cost ($), all
 * as per-run means. Suite specifics (case count, runs, thinking level, timeout,
 * pricing source) live in the footnote strings, not in the table.
 * - Data analysis: 15 tasks, single run, USD pricing.
 * - Coding: 40 tasks x 2 runs averaged; official CNY pricing converted at $1 = ¥7
 *   (0.289 / 0.338 / 0.299 CNY per run).
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

const MODEL = "DeepSeek V4 Pro";

export const DATA_BENCH: BenchResult[] = [
  {
    kind: "penguin",
    framework: "PenguinHarness",
    model: MODEL,
    accuracyPct: 66.7,
    tokensM: 18.037757,
    costUsd: 0.552406,
    emphasized: true,
  },
  {
    kind: "claude",
    framework: "Claude Code",
    model: MODEL,
    accuracyPct: 66.7,
    tokensM: 21.166305,
    costUsd: 0.640706,
  },
  {
    kind: "codex",
    framework: "OpenAI Codex",
    model: MODEL,
    accuracyPct: 46.7,
    tokensM: 13.362259,
    costUsd: 0.427011,
  },
];

export const CODE_BENCH: BenchResult[] = [
  {
    kind: "penguin",
    framework: "PenguinHarness",
    model: MODEL,
    accuracyPct: 50.0,
    tokensM: 2.1,
    costUsd: 0.0413,
    emphasized: true,
  },
  {
    kind: "claude",
    framework: "Claude Code",
    model: MODEL,
    accuracyPct: 48.75,
    tokensM: 2.0,
    costUsd: 0.0483,
  },
  {
    kind: "codex",
    framework: "OpenAI Codex",
    model: MODEL,
    accuracyPct: 42.5,
    tokensM: 2.65,
    costUsd: 0.0427,
  },
];

/** 66.7 -> "66.7%" (chart caps). */
export function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/** Table accuracy at suite precision: 66.7 (1dp) vs 48.75 (2dp). */
export function formatAccuracy(pct: number, dp: number): string {
  return pct.toFixed(dp);
}

/** 18.037757 -> "18.0M" / 2.65 -> "2.65M" (chart caps at suite precision). */
export function formatTokensM(tokens: number, dp = 1): string {
  return `${tokens.toFixed(dp)}M`;
}

/** Chart cost caps at suite precision: $0.55 vs $0.041. */
export function formatUsd(cost: number, dp = 2): string {
  return `$${cost.toFixed(dp)}`;
}
