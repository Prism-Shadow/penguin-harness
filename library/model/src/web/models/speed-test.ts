/**
 * Group speed test support: the per-model result shape and the color thresholds for the
 * card badges. Tones grade each metric independently — green is good, yellow middling,
 * red poor; thresholds are deliberately coarse (a card badge, not a benchmark).
 */
export interface SpeedResult {
  ok: boolean;
  /** Time to first streamed content, ms. */
  ttftMs?: number;
  /** Output tokens per second over the streaming window. */
  tps?: number;
  /** The whole request, ms: the reading for a model that is not chatted with. */
  latencyMs?: number;
  message?: string;
  /** The group test left this model out, and why, in the reader's words. */
  skipped?: string;
}

/** A latency for a card: milliseconds under a second, else seconds to one decimal. */
export function formatLatency(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export type SpeedTone = "green" | "yellow" | "red";

/** TTFT quality: under 1s green, up to 3s yellow, beyond red. */
export function ttftTone(ms: number): SpeedTone {
  return ms < 1000 ? "green" : ms <= 3000 ? "yellow" : "red";
}

/** TPS quality: 40+ tok/s green, 15+ yellow, below red. */
export function tpsTone(tps: number): SpeedTone {
  return tps >= 40 ? "green" : tps >= 15 ? "yellow" : "red";
}
