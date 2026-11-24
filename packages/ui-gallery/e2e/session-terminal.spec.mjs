import { expect, test } from "@playwright/test";

for (const [width, lang] of [
  [1280, "en"],
  [375, "zh"],
]) {
  test(`a conversation opens a working preview terminal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`app.html?route=%2Fchat%2Fs-hooks-index&lang=${lang}&theme=modern`);
    const picker = page.getByTestId("dock-toggle-right");
    await expect(picker).toBeVisible();
    if (width === 1280) {
      await page.keyboard.press("Control+Backquote");
    } else {
      await picker.click();
      await page.getByTestId("dock-pick-terminal").click();
    }
    const body = page.getByTestId("dock-terminal-body");
    await expect(body).toHaveAttribute("data-status", "ready");
    await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
    await page.keyboard.type("pwd");
    await page.keyboard.press("Enter");
    await expect(body.locator(".xterm-rows")).toContainText("/home/demo/projects/docs-expert");
    await page.getByTestId("terminal-new-tab").click();
    await expect(page.getByTestId("terminal-tab")).toHaveCount(2);
  });
}
