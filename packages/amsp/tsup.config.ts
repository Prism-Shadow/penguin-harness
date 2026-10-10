import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  // The package runs in Node 24 and in browsers: nothing Node-specific is resolved or injected,
  // and it has no runtime dependency to bundle.
  platform: "neutral",
  // One target for every package here (packages/cli/test/tsup-target.test.ts), matching
  // engines.node. Current browsers parse the syntax Node 24 does.
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
