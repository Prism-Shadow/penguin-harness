/** Types for hub.mjs, which the Vite plugin, the route list and the tests import. */
import type {
  BenchmarkDetail,
  HubIndex,
  LeaderboardDetail,
  PluginDetail,
} from "../../src/lib/hub/types";
import type { Published } from "./published.mjs";

export interface Hub {
  index: HubIndex;
  details: {
    plugin: Record<string, PluginDetail>;
    benchmark: Record<string, BenchmarkDetail>;
    leaderboard: Record<string, LeaderboardDetail>;
  };
}

export declare const PLUGINS_DIR: string;

/** The Release-pinned library packages the landing lists: each one's folder and source link. */
export declare function publishedLibraryPackages(): { dir: string; sourceUrl: string }[];

export declare function loadHub(options?: {
  refresh?: boolean;
  repo?: string;
  pluginsDir?: string;
  /** What the network gave this build; by default the copies `fetchPublished` kept. */
  published?: Published;
}): Hub;

export declare function hubRoutes(
  hub: Hub,
): { route: string; title: string; description: string }[];
