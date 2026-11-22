// `pnpm bench`: the built-in engine against this plugin's, operation by operation (bench/).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    include: ["bench/**/*.bench-run.ts"],
    testTimeout: 600_000,
  },
});
