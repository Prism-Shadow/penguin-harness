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
  },
});
