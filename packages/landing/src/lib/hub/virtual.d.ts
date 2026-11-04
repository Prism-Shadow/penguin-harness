/**
 * The build's hub module (scripts/hub-plugin.ts). Its records are typed where they are read
 * (data.ts): an ambient module cannot import this package's own types by relative path.
 */
declare module "virtual:penguin-hub" {
  export const plugins: unknown;
  export const benchmarks: unknown;
  export const leaderboards: unknown;
  export const pluginDetails: unknown;
  export const benchmarkDetails: unknown;
  export const leaderboardDetails: unknown;
}
