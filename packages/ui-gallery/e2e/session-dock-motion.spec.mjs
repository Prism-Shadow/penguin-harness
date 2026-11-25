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
        if (event.target.matches("[data-dock-content]"))
          window.recordDockTransition(event.propertyName);
      });
    });
    await page.getByTestId("dock-launcher").click();
    await page.getByTestId("dock-launcher-open-agents").click();
    const dock = page.locator('[data-testid="dock"][data-open="true"]');
    const surface = dock.locator("[data-dock-content]");
    const agent = dock.getByRole("tab", { name: /agent/i, selected: true });
    await expect(agent).toBeVisible();
    const axis = width < 600 ? "height" : "width";
    if (reducedMotion === "reduce") {
      await expect(surface).toHaveCSS("transition-property", "none");
    } else {
      await expect.poll(() => transitions).toEqual([axis]);
      await surface.evaluate((element) =>
        Promise.all(element.getAnimations().map((a) => a.finished)),
      );
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
// The content continues its entrance while the divider stays on the visible frame.
for (const phone of [false, true]) {
  test.describe(phone ? "phone touch" : "desktop mouse", () => {
    test.use({ viewport: { width: phone ? 390 : 1280, height: 900 }, hasTouch: phone });
    test("a first drag can interrupt the dock entrance", async ({ page }) => {
      await page.goto(
        `app.html?route=%2Fchat%2Fs-hooks-index&lang=en&theme=${phone ? "modern" : "geek"}`,
      );
      const dock = page.locator('[data-testid="dock"][data-open="true"]');
      const surface = dock.locator("[data-dock-content]");
      const handle = page.getByTestId("dock-resizer").filter({ visible: true });
      await page.evaluate(() => {
        document.addEventListener("transitionrun", (event) => {
          if (!event.target.matches("[data-dock-content]")) return;
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
        .poll(() => surface.evaluate((el) => el.getAnimations()[0]?.playState))
        .toBe("paused");
      const grip = await handle.boundingBox();
      const x = Math.round(grip.x + grip.width / 2);
      const y = Math.round(grip.y + grip.height / 2);
      const before = await surface.boundingBox();
      await surface.evaluate((el) => {
        const entry = el.getAnimations()[0];
        entry.currentTime = entry.effect.getTiming().duration * 0.55;
      });
      const later = await surface.boundingBox();
      const axis = phone ? "height" : "width";
      expect(later[axis] - before[axis]).toBeGreaterThan(10);
      const frame = await dock.boundingBox();
      const separation = phone ? Math.abs(frame.y - y) : Math.abs(frame.x - grip.x - grip.width);
      expect(separation).toBeLessThan(2);

      if (!phone) {
        const files = page.getByRole("button", { name: "Show 1 more file" });
        await files.scrollIntoViewIfNeeded();
        const button = await files.boundingBox();
        const clickX = Math.max(button.x + 2, Math.min(x, button.x + button.width - 2));
        await page.mouse.click(clickX, button.y + button.height / 2);
        await expect(files).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Show less" }).first()).toBeVisible();
      }
      if (phone) {
        const composer = page.locator('[data-slot="composer"] textarea:visible').first();
        await composer.tap();
        await expect(composer).toBeFocused();
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
      if (phone) {
        await dock.getByTestId("dock-fullscreen").tap();
        await expect(dock).toHaveAttribute("data-fullscreen", "full");
      }
    });
  });
}

// At its width cap the dock grows back when the window widens. Session info stays clickable
// up to the conversation's right edge while the tool content is still expanding.
test("widening an open dock leaves the Session info button clickable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("app.html?route=%2Fchat%2Fs-hooks-index&lang=en&theme=geek");
  await page.getByTestId("dock-launcher").click();
  await page.getByTestId("dock-launcher-open-agents").click();
  const handle = page.getByTestId("dock-resizer").filter({ visible: true });
  const dock = page.locator('[data-testid="dock"][data-position="right"]');
  const surface = dock.locator("[data-dock-content]");
  const info = page.getByRole("button", { name: "Session info", exact: true });
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + 3, grip.y + 100);
  await page.mouse.down();
  await page.mouse.move(1, grip.y + 100, { steps: 3 });
  await page.mouse.up();
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect.poll(async () => (await dock.boundingBox()).width).toBeLessThan(500);
  await surface.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await surface.evaluate((el) => {
    el.addEventListener(
      "transitionrun",
      (event) => {
        const animation = el
          .getAnimations()
          .find((a) => a.transitionProperty === event.propertyName);
        if (animation) {
          animation.pause();
          animation.currentTime = animation.effect.getTiming().duration * 0.3;
        }
      },
      { once: true },
    );
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect
    .poll(() => surface.evaluate((el) => el.getAnimations()[0]?.playState))
    .toBe("paused");
  const frame = await dock.boundingBox();
  const divider = await handle.boundingBox();
  expect(Math.abs(frame.x - divider.x - divider.width)).toBeLessThan(2);
  const button = await info.boundingBox();
  const x = Math.max(
    button.x + 2,
    Math.min(divider.x + divider.width / 2, button.x + button.width - 2),
  );
  await page.mouse.click(x, button.y + button.height / 2);
  await expect(info).toHaveAttribute("aria-expanded", "true");
});

for (const reducedMotion of ["no-preference", "reduce"]) {
  test(`a moved dock accepts a tab drag immediately with ${reducedMotion} motion`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.emulateMedia({ reducedMotion });
    await page.goto("app.html?route=%2Fchat%2Fs-hooks-index&lang=en&theme=modern");
    const right = page.locator('[data-testid="dock"][data-position="right"][data-open="true"]');
    const bottom = page.locator('[data-testid="dock"][data-position="bottom"][data-open="true"]');
    await page.getByTestId("dock-toggle-right").click();
    await right.getByTestId("dock-pick-workspace").click();
    await right.getByTestId("dock-add").click();
    await page.getByTestId("dock-add-trace").click();

    const arrivals = await page.evaluateHandle(() => {
      const transitions = [];
      document.addEventListener("transitionrun", (event) => {
        if (event.target.matches('[data-position="bottom"] > [data-dock-content]'))
          transitions.push(event.propertyName);
      });
      return transitions;
    });
    await right.getByTestId("dock-move").click();
    const tab = bottom.locator('[data-tab-id="workspace"]');
    const box = await tab.boundingBox();
    const x = box.x + box.width / 2;
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x + 10, box.y - 120, { steps: 5 });
    const target = page.locator('[data-testid="dock-layout-target"][data-dock-pos="right"]');
    await expect(target).toBeVisible();
    expect(await arrivals.jsonValue()).toEqual([]);
    const drop = await target.boundingBox();
    await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2);
    await page.mouse.up();
    await expect(right.locator('[data-tab-id="workspace"][data-active="true"]')).toBeVisible();
  });
}
