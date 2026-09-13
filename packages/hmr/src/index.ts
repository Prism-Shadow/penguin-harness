/**
 * @prismshadow/penguin-hmr — the hot-update MECHANISM, and nothing else.
 *
 * What a deployment does is not in this package and must never be: see README.md, which
 * states the rule and the reason it is enforced by a package boundary rather than by
 * discipline. The four exports below are the whole mechanism:
 *
 * - {@link hmrMain} — the layer's entry: the frozen operations (which generation a request
 *   goes to, how a push is applied, what the product refreshes once one is current).
 * - {@link HmrHost} — the version store, the atomic `harness.json` commit, and the
 *   park → boot → swap it drives (with recovery when a boot fails).
 * - {@link HotResources} — the registry live objects ride across a swap in.
 * - the manifest reader/writer — what a committed version is, on disk.
 * - the interface diff — what a handshake reports when two generations disagree.
 */
export {
  hmrMain,
  hmrControl,
  admitsUpgradeRoute,
  parseUpgradeTarget,
  upgradeEndpoint,
  HMR_ROUTE_PREFIX,
  HMR_UPGRADE_PATH,
  HMR_PROBE_PATH,
  HMR_BLOBS_PATH,
  probeEndpoint,
  blobEndpoint,
} from "./main.js";
export type { Hmr, Replace } from "./main.js";
export { HmrHost } from "./host.js";
export type {
  PlatformBundle,
  GitSource,
  UpgradeAssets,
  UpgradeAllTarget,
  UpgradeOutcome,
} from "./host.js";
export { HotResources } from "./resources.js";
export * from "./manifest.js";
export * from "./ifaces-diff.js";
