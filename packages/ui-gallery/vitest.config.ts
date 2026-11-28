/**
 * Vitest config kept separate from vite.config.ts (vitest's embedded vite types conflict with
 * this package's vite 7 plugin types). A node environment suffices: the tests cover the
 * gallery's pure modules and the demo store, which never touches the DOM. The network swap
 * plugin is applied here too, so a test can import the Web App's endpoint wrappers and drive
 * them against the mock — that is how the coverage test walks every endpoint. The browser checks
 * under e2e/ are Playwright's (`test:e2e`), not vitest's.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { mockWebNetwork } from "./src/app/mock/vite-plugin";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  plugins: [mockWebNetwork()],
  // The Web App's sources this suite compiles reach the session domain's web half through the
  // same face specifiers the app's build aliases (vite.config.ts): the framed app's boot and
  // the moved modules' consumption of the app's internals (src/internal.ts).
  resolve: {
    alias: [
      {
        find: /^@prismshadow\/penguin-library-session\/web$/,
        replacement: at("../../library/session/src/web/index.ts"),
      },
      {
        find: /^@prismshadow\/penguin-library-session\/web\/(.*)$/,
        replacement: `${at("../../library/session/src/web")}/$1`,
      },
      {
        find: /^@prismshadow\/penguin-web\/internal$/,
        replacement: at("../web/src/internal.ts"),
      },
      {
        find: /^@prismshadow\/penguin-web\/internal-hub$/,
        replacement: at("../web/src/internal-hub.ts"),
      },
    ],
  },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
