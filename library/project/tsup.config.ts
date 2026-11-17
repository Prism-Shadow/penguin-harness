import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/project.ts",
    "src/repos/agents.ts",
    "src/repos/index.ts",
    "src/repos/members.ts",
    "src/repos/projects.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
