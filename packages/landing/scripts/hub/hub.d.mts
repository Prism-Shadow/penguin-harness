/** Types for hub.mjs, which the Vite plugin, the route list and the tests import. */
import type {
  BenchmarkDetail,
  HubIndex,
  LeaderboardDetail,
  PluginDetail,
} from "../../src/lib/hub/types";

export interface Hub {
  index: HubIndex;
  details: {
    plugin: Record<string, PluginDetail>;
    benchmark: Record<string, BenchmarkDetail>;
    leaderboard: Record<string, LeaderboardDetail>;
  };
}

export declare const PLUGINS_DIR: string;

export declare function loadHub(options?: {
  refresh?: boolean;
  repo?: string;
  pluginsDir?: string;
}): Hub;

export declare function hubRoutes(
  hub: Hub,
): { route: string; title: string; description: string }[];
