import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/projects.ts", "src/repos/projects.ts", "src/repos/members.ts", "src/repos/agents.ts", "src/repos/model-promotions.ts", "src/repos/model-provider-auth-tokens.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
