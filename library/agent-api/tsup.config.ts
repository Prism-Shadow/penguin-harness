import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/agent-api-repo.ts", "src/agent-api.ts", "src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
