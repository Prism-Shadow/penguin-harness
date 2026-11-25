import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/project.ts",
    "src/ports.ts",
    "src/access.ts",
    "src/project-service.ts",
    "src/events.ts",
    "src/model-requests.ts",
    "src/project-config-service.ts",
    "src/project-config-migrations.ts",
    "src/project-config-seed.ts",
    "src/connect-default-offer.ts",
    "src/protocol-detect.ts",
    "src/vision-detect.ts",
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
