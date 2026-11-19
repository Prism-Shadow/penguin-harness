// Given a live app, a second sidebar click or Back must reach the requested page during
// a transition. With reduced motion, navigation should settle immediately. With motion
// enabled, the same navigation should visibly follow each theme and respect the shell edge.
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
        document
          .getAnimations()
          .some(
            (animation) =>
              animation.effect?.pseudoElement === "::view-transition-new(penguin-page)",
          ),
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

test("themes lift, slide, scan and turn the same page in different ways", async ({ page }) => {
  await provisionAndLogin(page.request, "navthemes", "password123");
  for (const themeId of ["modern", "github", "geek", "doodle"]) {
    await page.request.put("/api/me/prefs", {
      data: { themeId, initialPasswordBannerDismissed: true },
    });
    await page.goto("/agents");
    await expect(page.locator("html")).toHaveAttribute("data-theme", themeId);
    const models = page.locator('.ui-shell [data-slot="nav"] a[href="/models"]').first();
    await expect(models).toBeVisible();
    // Sample the browser's own snapshots halfway through the actual navigation.
    await page.evaluate(() => {
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (...args) => {
        const transition = start(...args);
        window.frame = transition.ready.then(async () => {
          for (const animation of document.getAnimations()) {
            if (!animation.effect?.pseudoElement?.includes("(penguin-page)")) continue;
            animation.pause();
            animation.currentTime = animation.effect.getTiming().duration / 2;
          }
          await new Promise(requestAnimationFrame);
          const root = document.documentElement;
          const old = getComputedStyle(root, "::view-transition-old(penguin-page)");
          const next = getComputedStyle(root, "::view-transition-new(penguin-page)");
          return {
            corner: getComputedStyle(root, "::view-transition-group(penguin-page)")
              .borderTopLeftRadius,
            shellCorner: getComputedStyle(document.querySelector('.ui-shell > [data-slot="main"]'))
              .borderTopLeftRadius,
            opacity: Number(next.opacity),
            incomingShift: next.translate,
            oldClip: old.clipPath,
            newClip: next.clipPath,
            oldTransform: old.transform,
          };
        });
        return transition;
      };
    });
    await models.click();
    await page.waitForFunction(() => !!window.frame);
    const frame = await page.evaluate(() => window.frame);
    if (themeId === "modern") {
      expect(frame.opacity).toBeGreaterThan(0);
      expect(frame.opacity).toBeLessThan(1);
    } else if (themeId === "github") {
      expect(parseFloat(frame.incomingShift)).toBeGreaterThan(0);
    } else if (themeId === "geek") {
      expect(frame.oldClip).toMatch(/^inset\([1-9]/);
      expect(frame.newClip).toMatch(/^inset\(/);
    } else {
      expect(parseFloat(frame.corner)).toBeGreaterThan(0);
      expect(frame.corner).toBe(frame.shellCorner);
      expect(frame.oldClip).toMatch(/^polygon\(/);
      expect(frame.oldTransform).toMatch(/^matrix3d\(/);
    }
  }
});
