import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  // One target for every package here (packages/cli/test/tsup-target.test.ts), matching
  // engines.node. Current browsers parse the syntax Node 24 does.
  target: "node24",
  // The server imports this at run time and packages/ui bundles it for the browser: nothing
  // Node-specific is resolved or injected, and the micromark packages stay imports.
  platform: "neutral",
  dts: true,
  clean: true,
  sourcemap: true,
});
