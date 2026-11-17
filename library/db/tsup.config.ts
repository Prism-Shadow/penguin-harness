import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/database.ts", "src/index.ts", "src/migrations/index.ts", "src/migrations/runner.ts", "src/schema.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
