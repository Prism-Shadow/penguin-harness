// Given a live app, a second sidebar click or Back must reach the requested page during
// a transition. With reduced motion, navigation should settle immediately. With motion
// enabled, the same navigation should visibly follow each theme and respect the shell edge.
import { expect, test } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

test("page transitions leave the navigation live and respect reduced motion", async ({ page }) => {
  await provisionAndLogin(page.request, "navmotion", "password123");
  await page.request.put("/api/me/prefs", { data: { themeId: "modern" } });
  await page.goto("/chat/new");
  const agents = page.locator('.ui-shell [data-slot="nav"] a[href="/agents"]').first();
  const models = page.locator('.ui-shell [data-slot="nav"] a[href="/models"]').first();
  await expect(agents).toBeVisible();
  // Hold the transition long enough to interact during it, independent of machine speed.
  await page.addStyleTag({ content: ":root { --ui-page-duration: 1s !important; }" });
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

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    document.documentElement.dataset.motion = "reduced";
  });
  await agents.click();
  await expect(agents).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => window.startedTransitions)).toBe(0);
});

test("a page refocuses, dissolves or settles in place, and Primer goes straight to the destination", async ({
  page,
}) => {
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
            oldOpacity: Number(old.opacity),
            incomingFilter: next.filter,
            outgoingMask: old.maskImage,
            oldTransform: old.transform,
            newTransform: next.transform,
          };
        });
        return transition;
      };
    });
    await models.click();
    await expect(models).toHaveAttribute("aria-current", "page");
    if (themeId === "github") {
      expect(await page.evaluate(() => !!window.frame)).toBe(false);
      continue;
    }
    await page.waitForFunction(() => !!window.frame);
    const frame = await page.evaluate(() => window.frame);
    expect(frame.corner).toBe(frame.shellCorner);
    expect(frame.oldTransform).toBe("none");
    expect(frame.newTransform).toBe("none");
    if (themeId === "modern") {
      expect(frame.opacity + frame.oldOpacity).toBeCloseTo(1);
      expect(frame.incomingFilter).toMatch(/blur\((0\.|1\.)/);
      expect(frame.incomingShift).toBe("none");
    } else if (themeId === "geek") {
      // Midway, the solid cover must already be translucent so the tiled mask is visible.
      expect(frame.outgoingMask).toMatch(/linear-gradient\(rgba\(/);
      expect(frame.outgoingMask).toContain("url(");
      expect(frame.oldOpacity).toBeGreaterThan(0);
      expect(frame.oldOpacity).toBeLessThan(1);
    } else {
      const [x, y] = frame.incomingShift.split(" ").map(parseFloat);
      expect(x).toBe(0);
      expect(Math.abs(y)).toBeGreaterThan(0);
      expect(Math.abs(y)).toBeLessThan(3);
    }
  }
});
