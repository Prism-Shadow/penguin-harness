import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/contract.ts",
    "src/index.ts",
    "src/types.ts",
    "src/workspace-files-service.ts",
    "src/workspace-group.ts",
    "src/workspace-guard.ts",
    "src/workspace-archive.ts",
    "src/drafts.ts",
    "src/user-drafts.ts",
    "src/draft-shortcuts.ts",
    "src/directory-skills.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
