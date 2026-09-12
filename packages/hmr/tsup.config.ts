import { defineConfig } from "tsup";

export default defineConfig({
  // Two entries: the mechanism, and the harness.json reader on its own — the CLI's thin
  // loader resolves the committed cli bundle through that reader with no host in the process.
  entry: { index: "src/index.ts", manifest: "src/manifest.ts" },
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
