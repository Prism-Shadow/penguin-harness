/**
 * Stat icons: which registry glyph stands for each stat, shared as a single source by the chat
 * page header, the chat page stats row, and the Trace page turn cards.
 *
 * Arrows read by "where the tokens go": **up = input** (sent up to the model), **down = output**
 * (returned by the model). The three surfaces used to carry their own copies of these paths, which
 * made it easy to flip the direction in one place and leave the others wrong — so the choice is
 * made here once, and the drawings live in the shared registry.
 */
import { ICONS } from "@prismshadow/penguin-ui";

export const STAT_ICONS = {
  /** Input (arrow rising from the baseline: tokens sent up to the model) */
  input: ICONS.arrowUpFromLine,
  /** Output (arrow falling to the baseline: tokens returned by the model) */
  output: ICONS.arrowDownToLine,
  /** Cache hit (bullseye: the portion of this turn's input that hit cache and didn't need recomputation) */
  cacheHit: ICONS.target,
  /** Token total (stacked cylinders: session-level total, used only in the chat page header) */
  tokens: ICONS.database,
  /** Tool calls (wrench) */
  toolCalls: ICONS.wrench,
  /** Output TPS (speedometer: half ring + needle) */
  tps: ICONS.gauge,
  /** Elapsed time (clock) */
  elapsed: ICONS.clockCompact,
  /** Cost (dollar sign in a circle) */
  cost: ICONS.coin,
  /** Copy */
  copy: ICONS.copy,
  /** Copied (checkmark) */
  check: ICONS.check,
} as const;
