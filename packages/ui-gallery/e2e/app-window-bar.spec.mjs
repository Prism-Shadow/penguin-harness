/**
 * A workbench with several pages in the App Center's window. Its page names come from the
 * workbench and its window controls must stay reachable at the reader's text size.
 * - On a touch phone, the app name and window actions stay visible while the reader changes pages.
 * - In a wide window, the same page switcher shares the title row with the window actions.
 */
import { expect, test } from "@playwright/test";

for (const phone of [true, false]) {
  test.describe(phone ? "phone workbench" : "desktop workbench", () => {
    test.use({
      viewport: { width: phone ? 390 : 1280, height: 844 },
      hasTouch: phone,
      isMobile: phone,
    });

    test("keeps its name and actions in view when switching pages", async ({ page }) => {
      await page.goto("/lib.html?topic=layout&theme=doodle&lang=en&size=xl");
      const lastPage = page.getByRole("button", { name: "Archive", exact: true });
      const frame = page.locator(".lib-box").filter({ has: lastPage });
      const title = frame.getByRole("heading", { name: "Daily to-dos" });
      const close = frame.getByRole("button", { name: "Close", exact: true });
      await expect(title).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const space = await frame.evaluate((el) => {
        const bounds = el.getBoundingClientRect();
        const title = el.querySelector("h1");
        const lost = [...el.querySelectorAll("button:not([aria-pressed])")]
          .filter((button) => {
            const box = button.getBoundingClientRect();
            return box.left < bounds.left || box.right > bounds.right;
          })
          .map((button) => button.ariaLabel ?? button.textContent);
        return { lost, titleClipped: title.scrollWidth > title.clientWidth + 1 };
      });
      expect(space).toEqual({ lost: [], titleClipped: false });
      const tabBox = await lastPage.boundingBox();
      const closeBox = await close.boundingBox();
      if (phone) {
        expect(tabBox.y).toBeGreaterThanOrEqual(closeBox.y + closeBox.height);
        await lastPage.tap();
        expect(await page.evaluate(() => window.scrollX)).toBe(0);
      } else {
        expect(
          Math.abs(tabBox.y + tabBox.height / 2 - closeBox.y - closeBox.height / 2),
        ).toBeLessThan(2);
        await lastPage.click();
      }
      await expect(lastPage).toHaveAttribute("aria-pressed", "true");
    });
  });
}
