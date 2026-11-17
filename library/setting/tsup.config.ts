import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/attachment-limits.ts",
    "src/index.ts",
    "src/repos/index.ts",
    "src/repos/server-settings.ts",
    "src/repos/ui-prefs.ts",
    "src/setting.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
