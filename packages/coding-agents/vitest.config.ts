/**
 * Platform-aware test deadline for the same reason core's has one (see its config):
 * suites here spawn real subprocesses, and Windows runner I/O variance has pushed
 * individually fast tests past vitest's 5s default. 120s clears the observed tail
 * while still bounding a genuinely hung test; POSIX keeps the 5s default so a flake
 * is seen the first time. `retry` on win32 for the same spawn-race reason.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: process.platform === "win32" ? 120_000 : 5_000,
    retry: process.platform === "win32" ? 2 : process.platform === "darwin" ? 1 : 0,
  },
});
