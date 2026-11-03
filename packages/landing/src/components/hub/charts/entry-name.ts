/** How a chart names one leaderboard entry: its method (an RSI plugin, or the baseline) and model. */
import type { LeaderboardEntry } from "../../../lib/hub/types";

export interface EntryName {
  method: string;
  model: string;
}

export type NameOf = (entry: LeaderboardEntry) => EntryName;
