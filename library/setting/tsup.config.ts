import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/attachment-limits.ts",
    "src/desktop-service.ts",
    "src/desktop-update-port.ts",
    "src/index.ts",
    "src/keybindings.ts",
    "src/plugin-module-preinstalls.ts",
    "src/plugin-module-requests.ts",
    "src/repos/index.ts",
    "src/repos/plugin-module-preinstalls.ts",
    "src/repos/plugin-module-requests.ts",
    "src/repos/server-settings.ts",
    "src/repos/ui-prefs.ts",
    "src/setting.ts",
    "src/theme-store.ts",
    "src/types.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
