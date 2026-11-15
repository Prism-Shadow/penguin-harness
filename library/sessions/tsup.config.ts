import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/sessions.ts", "src/repos/sessions.ts", "src/repos/schedules.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
