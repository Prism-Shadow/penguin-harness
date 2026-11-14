/**
 * The hub's records, from the build's `virtual:penguin-hub` module: the summaries every list
 * page reads, and a loader per detail page, each a chunk of its own.
 */
import * as hub from "virtual:penguin-hub";
import type {
  BenchmarkDetail,
  BenchmarkSummary,
  LeaderboardDetail,
  LeaderboardSummary,
  PluginDetail,
  PluginSummary,
} from "./types";

type Loaders<T> = Record<string, () => Promise<{ default: T }>>;

export const plugins = hub.plugins as PluginSummary[];
export const benchmarks = hub.benchmarks as BenchmarkSummary[];
export const leaderboards = hub.leaderboards as LeaderboardSummary[];

export interface DetailOf {
  plugin: PluginDetail;
  benchmark: BenchmarkDetail;
  leaderboard: LeaderboardDetail;
}

const details = {
  plugin: hub.pluginDetails,
  benchmark: hub.benchmarkDetails,
  leaderboard: hub.leaderboardDetails,
} as { [K in keyof DetailOf]: Loaders<DetailOf[K]> };

/** A detail record by id, or null when there is no such entry. */
export async function loadDetail<K extends keyof DetailOf>(
  kind: K,
  id: string,
): Promise<DetailOf[K] | null> {
  const loaders: Loaders<DetailOf[K]> = details[kind];
  const load = Object.hasOwn(loaders, id) ? loaders[id] : undefined;
  return load ? (await load()).default : null;
}
