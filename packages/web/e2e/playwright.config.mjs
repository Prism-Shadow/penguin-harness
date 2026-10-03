import { defineConfig } from "@playwright/test";

/**
 * Specs that need a server with a plugin set of their own, by the set's name (run.sh starts one
 * server per set and names it in E2E_PLUGIN_SET). Every other spec runs in the "default" set, the
 * one a run without E2E_PLUGIN_SET gets too.
 */
const OWN_SETS = {
  "no-evaluation-center": ["**/page-removal.spec.mjs"],
};
const own = OWN_SETS[process.env.E2E_PLUGIN_SET ?? "default"];

export default defineConfig({
  testDir: ".",
  ...(own ? { testMatch: own } : { testIgnore: Object.values(OWN_SETS).flat() }),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL,
    headless: true,
    locale: "zh-CN",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
