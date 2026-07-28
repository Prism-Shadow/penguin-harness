/**
 * Vitest config for the server. Mirrors core's platform-aware deadline rationale: these
 * tests build full app instances over real SQLite files and Agent State trees, and the
 * Windows CI runners' I/O variance (Defender first-touch scans, slow handle release)
 * pushes individually fast tests and cleanup hooks past the 5s/10s defaults — a
 * different file on each run. Larger deadlines change nothing for passing tests; POSIX
 * keeps the defaults to fail fast during local development. The hook timeout matters
 * here specifically: `cleanup()` removes the whole test root, and on win32 that rm can
 * legitimately take retries (see helpers.ts).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: process.platform === "win32" ? 30_000 : 5_000,
    hookTimeout: process.platform === "win32" ? 30_000 : 10_000,
  },
});
