import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/projects.ts", "src/repos/projects.ts", "src/repos/members.ts", "src/repos/agents.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
