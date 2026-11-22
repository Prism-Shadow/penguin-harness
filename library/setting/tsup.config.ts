import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/attachment-limits.ts",
    "src/index.ts",
    "src/plugin-module-preinstalls.ts",
    "src/plugin-module-requests.ts",
    "src/repos/index.ts",
    "src/repos/plugin-module-preinstalls.ts",
    "src/repos/plugin-module-requests.ts",
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
