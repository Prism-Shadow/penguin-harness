import { defineConfig } from "tsup";

export default defineConfig({
  // model-catalog gets its own entry point: pure data, no Node dependency, so web can bundle it directly via subpath import.
  entry: [
    "src/index.ts",
    "src/omnimessage/index.ts",
    // Message markers: their own entry so hosts (web/server/cli) can import the marker
    // producers and parsers without pulling the rest of the SDK surface.
    "src/omnimessage/markers/index.ts",
    "src/interfaces.ts",
    // The extension contract: types only, so an extension package compiles against the SDK
    // without depending on whatever embeds it.
    "src/extension/index.ts",
    "src/state/model-catalog.ts",
    // Hot-update kernel: zero-dependency subpath so web can bundle it directly.
    "src/kernel/index.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
