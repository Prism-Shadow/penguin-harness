/**
 * The plugin's own suites: the server half's units (driver, page scripts, tabs, history, import,
 * the route groups on a bare Hono app) and the Skill files. The suites that boot the whole App
 * with this plugin loaded live in the host (packages/server/test/builtin-browser/).
 *
 * The server half reaches the host through `@prismshadow/penguin-server/plugin` (and the API's
 * types through `/api`), resolved to the server's sources the way tsconfig.json resolves them:
 * the plugin does not depend on the server package, which depends on it.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const server = (file: string) =>
  fileURLToPath(new URL(`../../packages/server/src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@prismshadow/penguin-server/plugin": server("plugin/index.ts"),
      "@prismshadow/penguin-server/api": server("api/types.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
