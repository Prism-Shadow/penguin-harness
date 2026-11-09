import { defineConfig } from "tsup";

export default defineConfig({
  // The grammar only. The checker CLI (src/cli.ts) is the one Node-only file: it is bundled into
  // the a2ui Skill's scripts/check.mjs by scripts/build-a2ui-check.mjs and is deliberately not an
  // entry here.
  entry: ["src/index.ts"],
  format: ["esm"],
  // One target for every package here (packages/cli/test/tsup-target.test.ts), matching
  // engines.node. Current browsers parse the syntax Node 24 does.
  target: "node24",
  // The grammar runs in Node and in browsers (the Web App bundles it): nothing Node-specific is
  // resolved or injected, and it has no runtime dependency to bundle.
  platform: "neutral",
  dts: true,
  clean: true,
  sourcemap: true,
});
