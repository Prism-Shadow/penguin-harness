import { expect, test } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

test("page transitions leave the navigation live and respect reduced motion", async ({ page }) => {
  await provisionAndLogin(page.request, "navmotion", "password123");
  await page.goto("/chat/new");
  const agents = page.locator('.ui-shell [data-slot="nav"] a[href="/agents"]').first();
  const models = page.locator('.ui-shell [data-slot="nav"] a[href="/models"]').first();
  await expect(agents).toBeVisible();
  // Hold the transition long enough to interact during it, independent of machine speed.
  await page.addStyleTag({ content: ":root { --ui-dur-enter: 1s !important; }" });
  await page.evaluate(() => {
    window.firstNavigation = document.querySelector('.ui-shell [data-slot="nav"]');
    window.firstViewport = document.querySelector("[data-page-viewport]");
  });
  await agents.click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.getAnimations().some((animation) => animation.animationName === "ui-page-in"),
      ),
    )
    .toBe(true);
  // The next real click can reach the sidebar before the currently moving picture finishes.
  await models.click();
  await expect(page).toHaveURL(/\/models$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(agents).toHaveAttribute("aria-current", "page");
  expect(
    await page.evaluate(
      () =>
        window.firstNavigation === document.querySelector('.ui-shell [data-slot="nav"]') &&
        window.firstViewport === document.querySelector("[data-page-viewport]"),
    ),
  ).toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.matches(":active-view-transition")))
    .toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    window.startedTransitions = 0;
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => {
      window.startedTransitions++;
      return start(...args);
    };
  });
  await models.click();
  await expect(models).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => window.startedTransitions)).toBe(0);
});
