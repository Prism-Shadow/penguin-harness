import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/repos/index.ts",
    "src/repos/schedules.ts",
    "src/repos/sessions.ts",
    "src/session.ts",
    "src/access.ts",
    "src/resources.ts",
    "src/schedule-file.ts",
    "src/schedule-store.ts",
    "src/schedules.ts",
    "src/schedules-status.ts",
    "src/mtime-gate.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
