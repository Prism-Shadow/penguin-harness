/**
 * Vitest config kept separate from vite.config.ts (vitest's embedded vite types conflict with
 * this package's vite 7 plugin types). A node environment suffices: the tests cover the
 * gallery's pure modules and the demo store, which never touches the DOM. The network swap
 * plugin is applied here too, so a test can import the Web App's endpoint wrappers and drive
 * them against the mock — that is how the coverage test walks every endpoint.
 */
import { defineConfig } from "vitest/config";
import { mockWebNetwork } from "./src/app/mock/vite-plugin";

export default defineConfig({
  plugins: [mockWebNetwork()],
  test: { environment: "node" },
});
