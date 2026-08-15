/**
 * The unified bundle entry point — esbuild's one compile target for
 * `node scripts/watch-push.mjs` (see `compilePlatform` there): the self-contained
 * single-file ESM pushed over HTTP to POST /api/hmr/upgrade.
 *
 * ONE bundle, two exports:
 * - `hotPlatform` — loaded by HmrHost.doUpgradeAll (packages/server/src/hmr/host.ts),
 *   this build's business platform. Re-exported (as `hotPlatform`) from
 *   @prismshadow/penguin-server's own packaged default `packagedPlatform` (a bare
 *   mechanism-only stub until a real business platform replaces it — see that
 *   package's src/platform/platform.ts).
 * - `cli` — dynamically imported by packages/cli's own thin loader
 *   (src/index.ts's runHot) on every `penguin` invocation once this version is
 *   pushed. See cli-impl.ts's module doc for what it does and does not do.
 *
 * This file lives in packages/cli (not packages/server) so the dependency direction
 * stays cli → server, never the reverse: the CLI's command implementations
 * (run/chat/config) are cli-owned source, imported here alongside server's platform
 * export to produce one bundle that hot-swaps both together.
 *
 * Hot-pushing this bundle therefore hot-swaps the running platform instance AND the
 * CLI's command implementations, in the same atomic step (see host.ts's module doc:
 * "platform = cli + platform code + web, one indivisible version").
 */
export { cli } from "./cli-impl.js";
export { packagedPlatform as hotPlatform } from "@prismshadow/penguin-server/platform";
