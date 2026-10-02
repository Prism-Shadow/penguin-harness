/**
 * Vitest config for sandbox-bwrap. The one non-default setting is the global setup that puts the
 * bubblewrap this plugin ships in place before the live suite runs (see test/global-setup.ts);
 * which files are collected is vitest's default, as before this file existed.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
  },
});
