/**
 * The server package's platform export: the entry the dev watch-and-push loop
 * (`pnpm dev:server`) compiles to one file and pushes to a waiting runtime.
 *
 * The platform units are the existing packages — this server package is the
 * backend platform, the web package the frontend one. This file re-exports
 * the package's hot-swappable surface as `hotPlatform` (`{ id, iface, impl }`,
 * the single-file contract the hot host loads). It is NOT a tsup entry point
 * (tsup only bundles index/api/lock/initial-password), so it adds nothing to
 * the shipped server build. As more of the package's services move under the
 * platform tree, this entry stays the same — the watcher just recompiles a
 * bigger graph.
 */
export { platformV2 as hotPlatform } from "./platform-v2.js";
