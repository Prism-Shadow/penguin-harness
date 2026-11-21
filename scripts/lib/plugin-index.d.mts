/** Types for plugin-index.mjs, which the server's typechecked tests import. */
import type { ExternalPin } from "./external-plugins.mjs";

export declare const PLUGIN_INDEX_URL: string;
export declare function pluginIndexUrl(env?: NodeJS.ProcessEnv): string;
export declare function readPluginIndex(url: string): Promise<unknown[]>;
export declare function indexProblem(index: unknown[], pin: ExternalPin): string | null;
export declare function checkPinsAgainstIndex(
  pins: ExternalPin[],
  url: string,
): Promise<{ problems: string[] } | { skipped: string }>;
export declare function fetchFromGithubChannel(
  pin: ExternalPin,
  url: string,
): Promise<{ bytes: Buffer; source: string }>;
