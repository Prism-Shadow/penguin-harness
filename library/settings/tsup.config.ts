import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/attachment-limits.ts",
    "src/repos/index.ts",
    "src/repos/server-settings.ts",
    "src/repos/ui-prefs.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
