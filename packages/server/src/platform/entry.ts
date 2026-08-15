/**
 * The server package's platform export: the entry the dev watch-and-push loop
 * (`scripts/watch-push.mjs`) compiles to one file and pushes to a waiting
 * runtime as this build's business platform.
 *
 * `platform`, `cli` (packages/cli/src/cli.ts), and the web dist are three
 * independently compiled artifacts pushed together in ONE atomic request to
 * POST /api/hmr/upgrade — see packages/server/src/hmr/host.ts's module doc for
 * why "one atomic push" does not mean "one physical bundle". This file's only
 * job is to re-export the package's hot-swappable surface as `hotPlatform`
 * (`{ id, iface, impl }`, the contract HmrHost.doUpgradeAll loads and boots) —
 * it carries no `cli` export, and none is expected of it.
 *
 * It is NOT a tsup entry point (tsup only bundles this package's own dist
 * surface: index/api/lock/initial-password/hmr/manifest), so it adds nothing
 * to the shipped server build; only esbuild (in watch-push.mjs) compiles it,
 * straight from source, never through the published dist. As more of the
 * package's services move under the platform tree, this entry stays the
 * same — the watcher just recompiles a bigger graph.
 */
export { packagedPlatform as hotPlatform } from "./platform.js";
