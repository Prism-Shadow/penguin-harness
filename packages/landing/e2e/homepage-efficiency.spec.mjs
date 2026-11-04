/**
 * Given a long homepage, one live app stays mounted and offscreen diagrams do no animated work.
 * Given a scrolled page, Back to top returns to the heading, restores keyboard focus and hides.
 * Given reduced motion, returning to the top is immediate.
 */
import { test, expect } from "@playwright/test";

for (const [width, lang, label] of [
  [1440, "en", "Back to top"],
  [390, "zh", "回到顶部"],
]) {
  test(`keeps one app and offers a return to the heading (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((lang) => localStorage.setItem("penguin-site.lang", lang), lang);
    await page.goto("/");
    const top = page.getByRole("button", { name: label, exact: true });
    await expect(top).toHaveCount(0);
    await page
      .getByRole("link", { name: lang === "zh" ? "在画廊中打开" : "Open in the gallery" })
      .scrollIntoViewIfNeeded();
    await expect(page.locator("iframe")).toHaveCount(1);
    await expect(page.locator(".neon-blob")).toHaveCount(0);
    await expect(page.locator("#self-evolution animateMotion")).toHaveCount(0);
    if (width >= 768) {
      await page.locator('#self-evolution svg[role="img"]').scrollIntoViewIfNeeded();
      await expect(page.locator("#self-evolution animateMotion")).toHaveCount(6);
    } else {
      await page.locator("#self-evolution").scrollIntoViewIfNeeded();
      await expect(page.locator("#self-evolution animateMotion")).toHaveCount(0);
    }
    await expect(top).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(1);
    await top.focus();
    await top.press("Enter");
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator("#home-top")).toBeFocused();
    await expect(top).toHaveCount(0);
    await expect(page.locator("#self-evolution animateMotion")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("returns instantly under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("penguin-site.lang", "zh"));
  await page.goto("/");
  await page.evaluate(() => scrollTo({ top: 2000, behavior: "instant" }));
  const top = page.getByRole("button", { name: "回到顶部", exact: true });
  await expect(top).toBeVisible();
  await top.click();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator("#home-top")).toBeFocused();
});
