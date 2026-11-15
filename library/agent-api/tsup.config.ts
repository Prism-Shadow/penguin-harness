import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/agent-api.ts", "src/agent-api-repo.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
