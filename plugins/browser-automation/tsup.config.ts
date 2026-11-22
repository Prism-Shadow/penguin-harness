import { defineConfig } from "tsup";
import { ESM_CJS_BANNER } from "../../scripts/esm-cjs-banner.mjs";

/**
 * The server half (`.`): one ESM file the plugin loader imports from the builtin prefix. A
 * builtin plugin bundles what it runs (scripts/build-plugins.mjs), so everything is inlined: the
 * host face's few values and the library packages' (resolved to their sources through the
 * server's tsconfig paths, which tsconfig.json extends), core's decorators, Hono and ws. Only
 * Node's built-ins stay imports, and ws's two optional native accelerators, which it loads
 * inside a try and runs without.
 *
 * The metafile lists every file the bundle read, inside this package or not: the builtin prefix's
 * cache hashes them (scripts/build-plugins.mjs), so an edit to the host code bundled here rebuilds
 * the prefix.
 *
 * The web half (`./web`) and the CLI half (`./cli`) are source the Web App's and the CLI's own
 * builds compile from the workspace; nothing here builds them.
 */
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node24",
  platform: "node",
  tsconfig: "tsconfig.server.json",
  dts: false,
  clean: true,
  sourcemap: true,
  metafile: true,
  noExternal: [/.*/],
  external: ["bufferutil", "utf-8-validate"],
  // ws is CommonJS and requires Node's built-ins: the shared ESM/CJS banner declares `require`.
  banner: { js: ESM_CJS_BANNER },
});
