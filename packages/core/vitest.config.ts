/**
 * Vitest config for core. The one non-default setting is a platform-aware test timeout:
 * many core tests spawn a real shell (Git-Bash on the Windows CI runners) or write the
 * full Agent State layout, and Windows runner I/O variance (cold shell spawns, Defender
 * first-touch scans, slow-disk moments) has pushed individually fast tests past vitest's
 * 5s default — a different test on each run. A larger failure deadline changes nothing
 * for passing tests; POSIX keeps the 5s default to fail fast during local development.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: process.platform === "win32" ? 30_000 : 5_000,
  },
});
