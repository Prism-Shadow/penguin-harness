import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as const,
  // One target for every package here (packages/cli/test/tsup-target.test.ts), matching
  // engines.node. Current browsers parse the syntax Node 24 does.
  target: "node24",
  sourcemap: true,
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: "src/index.ts",
      // The OmniMessage records and their guards: what core re-exports as its own protocol types.
      omnimessage: "src/omnimessage/types.ts",
      // The message markers' producers and parsers: core's `@prismshadow/penguin-core/markers`.
      markers: "src/omnimessage/markers/index.ts",
    },
    // The package runs in Node 24 and in browsers: nothing Node-specific is resolved or injected,
    // and it has no runtime dependency to bundle.
    platform: "neutral",
    dts: true,
    // The two builds run side by side: each cleans its own output only.
    clean: ["!browser/**"],
  },
  {
    ...shared,
    // The browser build: the root entry as one ES module with nothing to resolve, for a page to
    // import by URL (the server serves it to Workbench pages).
    entry: { amsp: "src/index.ts" },
    outDir: "dist/browser",
    platform: "browser",
    splitting: false,
    dts: false,
    clean: true,
  },
]);
