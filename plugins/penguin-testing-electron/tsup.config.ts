import { defineConfig } from "tsup";

/**
 * The driver library's publish build: the one entry the npm consumer imports
 * (`@penguinharness/penguin-testing-electron/driver`). `moduleMetaOf` (penguin-core) is
 * bundled in — the consumer's test code has no penguin-core of its own; @playwright/test
 * stays external — the author's e2e setup carries it in the process that runs the units,
 * and a runtime dependency here would have npm auto-install it into the harness's own
 * builtin prefix, where nothing but the locked native closure may live.
 */
export default defineConfig({
  entry: { driver: "src/driver.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["@playwright/test", "node:child_process", "node:fs", "node:path"],
});
