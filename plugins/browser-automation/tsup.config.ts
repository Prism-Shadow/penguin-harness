import { defineConfig } from "tsup";

/**
 * The server half (`.`): one ESM file the plugin loader imports from the builtin prefix. A
 * builtin plugin bundles what it runs (scripts/build-plugins.mjs), so everything is inlined: the
 * host face's few values and the library packages' (resolved to their sources through the
 * server's tsconfig paths, which tsconfig.json extends), core's decorators, Hono and ws. Only
 * Node's built-ins stay imports, and ws's two optional native accelerators, which it loads
 * inside a try and runs without.
 *
 * The web half (`./web`) and the CLI half (`./cli`) are source the Web App's and the CLI's own
 * builds compile; nothing here builds them.
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
  noExternal: [/.*/],
  external: ["bufferutil", "utf-8-validate"],
  // ws is CommonJS and requires Node's built-ins; in an ESM bundle those requires need a real
  // `require`, which an ES module does not have.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
