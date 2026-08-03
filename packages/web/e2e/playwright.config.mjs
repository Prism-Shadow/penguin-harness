import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
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
    // Below the xl breakpoint (1280) on purpose: the conversation outline docks at xl and
    // mirrors message texts into its entry previews, which would double every unscoped
    // getByText across the historical suite (Playwright's old default 1280×720 sat exactly
    // on the breakpoint). This pins the layout those specs were written against;
    // outline.spec.mjs opts into a wider viewport to cover the outline itself.
    viewport: { width: 1200, height: 720 },
  },
});
