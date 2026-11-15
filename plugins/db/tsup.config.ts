import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/repos/index.ts", "src/migrations/index.ts", "src/schema.ts", "src/attachment-limits.ts"],
    format: ["esm"],
    target: "node24",
    dts: true,
    clean: true,
    sourcemap: true,
  },
]);
