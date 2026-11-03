/**
 * How a chart names one leaderboard entry: `method` is what the board's entries differ in (the
 * algorithm, else the harness, else the model; the page decides), `model` tells two apart that
 * share it.
 */
import type { LeaderboardEntry } from "../../../lib/hub/types";

export interface EntryName {
  method: string;
  model: string;
}

export type NameOf = (entry: LeaderboardEntry) => EntryName;
