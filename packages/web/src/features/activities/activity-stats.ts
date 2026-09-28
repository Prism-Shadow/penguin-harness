/**
 * Loom's Activity Stats: how many assets the media plan asks for, how many are bound, and
 * how much the bound files weigh, by asset type and by language. Pure, so both tables and
 * their total come from one pass over what the server measured.
 */
import type { MediaStat } from "@prismshadow/penguin-server/api";

export interface StatsRow {
  key: string;
  count: number;
  bound: number;
  bytes: number;
  /** Bound, but no file was found for the binding, so its size is not in `bytes`. */
  missing: number;
}

const TYPE_ORDER: readonly MediaStat["type"][] = ["image", "audio", "video", "animation"];

function tally(stats: readonly MediaStat[], key: string): StatsRow {
  return {
    key,
    count: stats.length,
    bound: stats.filter((stat) => stat.bound).length,
    bytes: stats.reduce((sum, stat) => sum + (stat.bytes ?? 0), 0),
    missing: stats.filter((stat) => stat.bound && stat.bytes === null).length,
  };
}

export function statsTables(stats: readonly MediaStat[]): {
  byType: StatsRow[];
  byLanguage: StatsRow[];
  total: StatsRow;
} {
  const languages = [...new Set(stats.map((stat) => stat.language))].sort((a, b) =>
    a === "en-US" ? -1 : b === "en-US" ? 1 : a.localeCompare(b),
  );
  return {
    byType: TYPE_ORDER.filter((type) => stats.some((stat) => stat.type === type)).map((type) =>
      tally(
        stats.filter((stat) => stat.type === type),
        type,
      ),
    ),
    byLanguage: languages.map((language) =>
      tally(
        stats.filter((stat) => stat.language === language),
        language,
      ),
    ),
    total: tally(stats, "total"),
  };
}
