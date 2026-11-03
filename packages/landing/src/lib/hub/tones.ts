/**
 * The hub's colours. A tone is an identity, not a status: each kind of entry has one (plugins
 * blue, benchmarks emerald, leaderboards amber) and each plugin category its own, so a card, its
 * page and the panels on it read as one family at a glance. Every tone is a light tint with a
 * darker ink in the light theme and the inverse in the dark; all solid, no gradients.
 */

export type HubTone = "blue" | "emerald" | "amber" | "violet" | "cyan" | "rose" | "slate";

/** A square tile behind a glyph or an icon. */
export const TONE_TILE: Record<HubTone, string> = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300",
  cyan: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

/** A small tag: tinted fill, the tone's ink, a hairline of the same hue. */
export const TONE_TAG: Record<HubTone, string> = {
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  amber:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  violet:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-200",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950 dark:text-cyan-200",
  rose: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200",
  slate:
    "border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300",
};

/** The glyph ink of a panel title. */
export const TONE_INK: Record<HubTone, string> = {
  blue: "text-blue-600 dark:text-blue-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  violet: "text-violet-600 dark:text-violet-400",
  cyan: "text-cyan-700 dark:text-cyan-400",
  rose: "text-rose-600 dark:text-rose-400",
  slate: "text-gray-500 dark:text-gray-400",
};

export const KIND_TONE = {
  plugin: "blue",
  benchmark: "emerald",
  leaderboard: "amber",
} as const satisfies Record<string, HubTone>;

const CATEGORY_TONE: Record<string, HubTone> = {
  rsi: "violet",
  "office-productivity": "emerald",
  "software-development": "blue",
  "ai-app-development": "amber",
  sandbox: "cyan",
};

/** A plugin category's tone; an unknown category is slate. */
export const categoryTone = (category: string): HubTone => CATEGORY_TONE[category] ?? "slate";

const FAMILY_TONES: readonly HubTone[] = ["emerald", "cyan", "blue", "violet", "amber", "rose"];

/**
 * A benchmark's tone, shared by its family: the id without the repository's prefix and without
 * a trailing split (`-test`, `-train`, `-val`), so a scenario's test and train sets match and
 * different scenarios tell apart in a long list.
 */
export function benchmarkTone(id: string): HubTone {
  const family = id.replace(/^penguinharness-benchmark-/, "").replace(/-(test|train|val)$/, "");
  let hash = 0;
  for (const char of family) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FAMILY_TONES[hash % FAMILY_TONES.length]!;
}
