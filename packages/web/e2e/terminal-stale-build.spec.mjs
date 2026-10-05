/**
 * A tab that outlived a web push (lib/stale-build.ts). The push replaced the dist, so the
 * xterm chunk names this tab's build asks for are gone, and the server's SPA fallback answers
 * them with index.html — exactly what 53531 did on 2026-10-05, when every Claude Code terminal
 * in a tab opened before the d531v20 → d531v21 push stayed on "connecting". The stale names are
 * simulated here by answering the chunks with index.html, the server's own fallback body.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const U = "stalebuilduser";
const P = "password123";
const XTERM_CHUNK = /\/assets\/(xterm|addon-[a-z-]+)-[^/]+\.js$/;

/** Answers xterm's chunks as a server does for names its dist no longer has, while `stale()`. */
async function staleXterm(page, stale) {
  await page.route(XTERM_CHUNK, async (route) => {
    if (!stale()) return route.continue();
    const html = await (await page.request.get(`${BASE}/`)).text();
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  });
}

test("a stale tab reloads once onto the current build and its terminal opens", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  let loads = 0;
  page.on("load", () => loads++);
  // Stale for the first page load only: after the reload the "current dist" has the chunks.
  await staleXterm(page, () => loads <= 1);
  await page.goto(`${BASE}/terminal`);
  await expect(page.locator('[data-testid="terminal-status"][data-status="ready"]')).toBeVisible({
    timeout: 30000,
  });
  expect(loads).toBe(2);
});

test("a chunk still missing after that reload is an error, not a reload loop", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  let loads = 0;
  page.on("load", () => loads++);
  await staleXterm(page, () => true);
  await page.goto(`${BASE}/terminal`);
  await expect(page.locator('[data-testid="terminal-status"][data-status="error"]')).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator('[data-testid="terminal-status"]')).toContainText(
    "dynamically imported module",
  );
  // Settle, then prove nothing kept reloading.
  await page.waitForTimeout(2000);
  expect(loads).toBe(2);
});
