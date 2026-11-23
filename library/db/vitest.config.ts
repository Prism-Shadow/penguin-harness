/**
 * Vitest config for the db package's tests. The db-upgrade suite exercises the messaging and
 * session repos against real migrations, and importing those packages through the workspace
 * links would make db depend on its own consumers — a cycle pnpm cannot topologically order
 * (it warns and falls back to serial builds). The aliases resolve the two siblings to their
 * TypeScript sources instead, so the package.json carries no dependency on them and the
 * workspace graph stays one-way; vitest compiles the sources directly, as it does the db
 * package's own test files.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@prismshadow/penguin-library-messaging",
        replacement: fileURLToPath(new URL("../messaging/src", import.meta.url)),
      },
      {
        find: "@prismshadow/penguin-library-session",
        replacement: fileURLToPath(new URL("../session/src", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
  },
});
