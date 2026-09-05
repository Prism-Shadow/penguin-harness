/**
 * Stat icons (24×24 line paths): **shared as a single source** by the chat
 * page header, the chat page stats row, and the Trace page turn cards.
 *
 * Arrows read by "where the tokens go": **up = input** (sent up to the
 * model), **down = output** (returned by the model). These paths used to be
 * duplicated across three components, making it easy to flip the direction
 * in only one place and leave the others wrong — so they're now consolidated
 * here as a single copy.
 */
export const STAT_ICONS = {
  /** Input (arrow rising from the baseline: tokens sent up to the model) */
  input: "M12 15V5m0 0L8 9m4-4l4 4M4 19h16",
  /** Output (arrow falling to the baseline: tokens returned by the model) */
  output: "M12 3v10m0 0l-4-4m4 4l4-4M4 19h16",
  /** Cache hit (bullseye: the portion of this turn's input that hit cache and didn't need recomputation) */
  cacheHit:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-3a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  /** Token total (stacked cylinders / database: session-level total, used only in the chat page header) */
  tokens:
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  /** Tool calls (wrench) */
  toolCalls: "M14.7 6.3a4 4 0 0 0-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-2.5 2.5-2-2 2.5-2.5z",
  /** Output TPS (speedometer: half ring + needle) */
  tps: "M5 18a8 8 0 1 1 14 0M12 12l4-3",
  /** Elapsed time (clock) */
  elapsed: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-14v5l3 2",
  /** Cost (dollar sign in a circle) */
  cost: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-15v12m2.6-9.3c-.5-.8-1.5-1.2-2.6-1.2-1.5 0-2.7.8-2.7 2 0 2.7 5.4 1.3 5.4 4 0 1.2-1.2 2-2.7 2-1.2 0-2.2-.5-2.7-1.4",
  /** Copy */
  copy: "M9 9h9v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9zM7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1",
  /** Copied (checkmark) */
  check: "M5 13l4 4L19 7",
} as const;
