import { expect, test } from "@playwright/test";

for (const [width, reducedMotion] of [
  [1280, "no-preference"],
  [375, "no-preference"],
  [375, "reduce"],
]) {
  test(`opening a Session tool preserves native dock motion at ${width}px with ${reducedMotion}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.emulateMedia({ reducedMotion });
    await page.goto("app.html?route=%2Fchat%2Fs-hooks-index&lang=en&theme=modern");
    const transitions = [];
    await page.exposeFunction("recordDockTransition", (property) => transitions.push(property));
    await page.evaluate(() => {
      document.addEventListener("transitionrun", (event) => {
        if (event.target.matches('[data-testid="dock"]'))
          window.recordDockTransition(event.propertyName);
      });
    });
    await page.getByTestId("dock-launcher").click();
    await page.getByTestId("dock-launcher-open-agents").click();
    const dock = page.locator('[data-testid="dock"][data-open="true"]');
    const agent = dock.getByRole("tab", { name: /agent/i, selected: true });
    await expect(agent).toBeVisible();
    const axis = width < 600 ? "height" : "width";
    if (reducedMotion === "reduce") {
      await expect(dock).toHaveCSS("transition-property", "none");
    } else {
      await expect.poll(() => transitions).toEqual([axis]);
      await dock.evaluate((element) => Promise.all(element.getAnimations().map((a) => a.finished)));
    }
    await dock.getByTestId("dock-add").click();
    await page.getByTestId("dock-add-trace").click();
    await dock.getByTestId("dock-add").click();
    await page.getByTestId("dock-add-agents").click();
    await expect(agent).toBeVisible();
    expect(transitions).toEqual(reducedMotion === "reduce" ? [] : [axis]);
  });
}

// The pointer targets a separator on one painted frame and presses on a later frame.
// Both the divider's settled position and the sliding border accept a first drag.
for (const phone of [false, true]) {
  test.describe(phone ? "phone touch" : "desktop mouse", () => {
    test.use({ viewport: { width: phone ? 390 : 1280, height: 900 }, hasTouch: phone });
    test("a first drag can interrupt the dock entrance", async ({ page }) => {
      await page.goto("app.html?route=%2Fchat%2Fs-hooks-index&lang=en&theme=modern");
      const dock = page.locator('[data-testid="dock"][data-open="true"]');
      const handle = page.getByTestId("dock-resizer").filter({ visible: true });
      await page.evaluate(() => {
        document.addEventListener("transitionrun", (event) => {
          if (!event.target.matches('[data-testid="dock"]')) return;
          const entry = event.target
            .getAnimations()
            .find((a) => a.transitionProperty === event.propertyName);
          if (entry) {
            entry.pause();
            entry.currentTime = entry.effect.getTiming().duration * 0.15;
          }
        });
      });
      await page.getByTestId("dock-launcher").click();
      await page.getByTestId("dock-launcher-open-agents").click();
      await expect
        .poll(() => dock.evaluate((el) => el.getAnimations()[0]?.playState))
        .toBe("paused");
      const grip = await handle.boundingBox();
      const x = Math.round(grip.x + grip.width / 2);
      const y = Math.round(grip.y + grip.height / 2);
      const before = await dock.boundingBox();
      await dock.evaluate((el) => {
        const entry = el.getAnimations()[0];
        entry.currentTime = entry.effect.getTiming().duration * 0.55;
      });
      const later = await dock.boundingBox();
      const axis = phone ? "height" : "width";
      expect(later[axis] - before[axis]).toBeGreaterThan(10);

      if (phone) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y + 45 }],
        });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 90, y, { steps: 3 });
        await page.mouse.up();
      }
      const after = await dock.boundingBox();
      const boundary = phone ? after.y : after.x;
      expect(Math.abs(boundary - (phone ? y + 45 : x + 90))).toBeLessThan(2);
    });
  });
}
