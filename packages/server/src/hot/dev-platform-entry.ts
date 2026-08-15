/**
 * The platform source unit that the dev watch-and-push loop compiles and
 * pushes to a waiting runtime (scripts/watch-push-platform.mjs).
 *
 * It re-exports the in-repo platform as `hotPlatform` — the single-file
 * contract the hot host loads (`{ id, iface, impl }`). This is NOT a tsup
 * entry point (tsup only bundles index/api/lock/initial-password), so it adds
 * nothing to the shipped server build; it exists solely for the dev compiler
 * to bundle into one file. As the platform grows to hold real business code,
 * this entry stays the same — the watcher just recompiles a bigger graph.
 */
export { platformV2 as hotPlatform } from "./platform-v2.js";
