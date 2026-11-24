/**
 * The homepage plays a single evolution round when its frame comes into view. Stopping restores
 * a new chat, and reduced motion waits for Play. Setup prompts stay out of the walkthrough.
 * The AMSP player has independent pause and resume controls.
 */
import { test, expect } from "@playwright/test";

const composer = '[data-slot="composer"] textarea';

async function openHero(page, lang = "zh", useVirtualClock = true) {
  await page.addInitScript((lang) => {
    localStorage.setItem("penguin-site.lang", lang);
    localStorage.setItem("penguin-site.theme", "light");
  }, lang);
  if (useVirtualClock) await page.clock.install({ time: new Date("2026-10-28T00:00:00Z") });
  await page.goto("/");
  await page
    .getByRole("button", { name: /^(Play demo|Stop demo|播放演示|停止演示)$/ })
    .scrollIntoViewIfNeeded();
  const iframe = page.locator('iframe[src*="fresh=1"]');
  await iframe.scrollIntoViewIfNeeded();
  const frame = iframe.contentFrame();
  await expect(frame.locator(composer)).toBeVisible();
  // Keep the controls and the app in view together; an offscreen walkthrough waits on visibility.
  await iframe
    .locator("xpath=../..")
    .locator(":scope > div")
    .first()
    .evaluate((bar) =>
      window.scrollTo({
        top: bar.getBoundingClientRect().top + scrollY - 120,
        behavior: "instant",
      }),
    );
  return { iframe, frame };
}

for (const [lang, play, stop] of [
  ["en", "Play demo", "Stop demo"],
  ["zh", "播放演示", "停止演示"],
]) {
  test(`plays, stops and restarts a single evolution round (${lang})`, async ({ page }) => {
    if (lang === "zh") await page.setViewportSize({ width: 390, height: 844 });
    const { frame } = await openHero(page, lang);
    const guide = frame.getByRole("dialog", {
      name: lang === "en" ? "Connect a model provider first" : "先连接一个模型供应商",
    });
    const passwordNotice = frame.getByText(
      lang === "en" ? /this account is using its initial password/i : /当前账号正在使用初始密码/,
    );
    await expect(frame.locator(composer)).not.toHaveValue("");
    await expect(guide).toHaveCount(0);
    await expect(passwordNotice).toHaveCount(0);
    const chart = frame.locator("main svg.ui-chart:visible").first();
    const evaluation = frame.getByRole("heading", {
      name: lang === "en" ? "Docs QA v1" : "文档问答 v1",
      exact: true,
    });
    for (let step = 0; step < 65 && !(await evaluation.isVisible()); step++) {
      await page.clock.runFor(1500);
    }
    await expect(evaluation).toBeVisible();
    await page.clock.runFor(600);
    await page.clock.fastForward(15_000);
    if (lang === "en") {
      await expect(frame.locator('[data-pane="left"] [data-slot="composer"]')).toBeVisible();
      await expect(frame.locator('[data-pane="right"] svg.ui-chart').first()).toBeVisible();
    } else {
      await expect(
        frame.locator('[data-pane="left"]:visible, [data-pane="right"]:visible'),
      ).toHaveCount(0);
    }
    await expect(chart).toBeVisible();
    await page.getByRole("button", { name: stop, exact: true }).click();
    await expect(frame.locator(composer)).toHaveValue("");
    await expect(guide).toHaveCount(0);
    await expect(passwordNotice).toHaveCount(0);
    await page.getByRole("button", { name: play, exact: true }).click();
    await expect(frame.locator(composer)).not.toHaveValue("");
  });
}

test("the desktop walkthrough finishes with its conversation beside the score curve in real time", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { frame } = await openHero(page, "en", false);
  const conversation = frame.locator('[data-pane="left"] [data-slot="composer"] textarea');
  const benchmark = frame.locator('[data-pane="right"]');
  await expect(benchmark.getByRole("heading", { name: "Docs QA v1", exact: true })).toBeVisible({
    timeout: 45_000,
  });
  await expect(benchmark.getByText("Score over time", { exact: true })).toBeVisible();
  await expect(conversation).toBeVisible();
  const plot = benchmark.locator("svg.ui-chart:visible").first();
  await expect(plot).toBeVisible();
  await expect
    .poll(() =>
      plot.evaluate(
        (svg) =>
          new Promise((resolve) => {
            const observer = new IntersectionObserver(
              ([entry]) => {
                observer.disconnect();
                resolve(entry.intersectionRatio);
              },
              { root: svg.ownerDocument.documentElement },
            );
            observer.observe(svg);
          }),
      ),
    )
    .toBeGreaterThan(0.99);
  const [inputBox, plotBox] = await Promise.all([conversation.boundingBox(), plot.boundingBox()]);
  expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(plotBox.x + 1);
});

test("the live homepage preview uses the new chat header and shortcut strip", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { frame } = await openHero(page, "en");
  await expect(
    frame.getByText("Create your first self-evolving agent OS.", { exact: true }),
  ).toBeVisible();
  await expect(frame.locator('[data-slot="counts"]')).toHaveCount(0);
  await expect(frame.locator('[data-slot="examples"]')).toBeVisible();
  await expect(frame.locator('[data-slot="version"]')).toContainText(
    /v[\d.]+ · Last updated \w+ \d+/,
  );
  expect(await frame.locator(composer).evaluate((el) => getComputedStyle(el).resize)).toBe("none");
});

for (const lang of ["en", "zh"]) {
  test(`the homepage keeps the App Center and skips setup prompts (${lang})`, async ({ page }) => {
    const { frame } = await openHero(page, lang);
    await expect(frame.getByRole("dialog")).toHaveCount(0);
    await frame
      .getByRole("link", { name: lang === "en" ? /^App Center(?: ·|$)/ : /^应用中心(?: ·|$)/ })
      .click();
    await expect(frame.locator('li[data-app="default_agent/slides"]')).toBeVisible();
    await expect(frame.locator('li[data-app="default_agent/first-workbench-guide"]')).toHaveCount(
      0,
    );
    await expect(
      frame.getByRole("region", {
        name: lang === "en" ? "Your first workbench" : "我的第一个工作台",
      }),
    ).toHaveCount(0);
  });
}

test("opens the installed workbenches without navigating away from the homepage", async ({
  page,
}) => {
  const { frame } = await openHero(page, "en");
  await page.clock.resume();
  const catalog = frame.getByRole("link", { name: /^App Center(?: ·|$)/ }).first();
  await catalog.click();
  for (const id of ["default_agent/slides", "default_agent/images", "penguin_support/support"]) {
    const app = id.split("/")[1];
    await frame.locator('li[data-app="' + id + '"] > button').click();
    const workbench = frame
      .locator('iframe[src*="/demo-workbenches/api/"][src*="/workbenches/' + app + '/ui/"]:visible')
      .contentFrame();
    if (app === "slides") {
      await workbench.locator("[data-open-deck]").first().click();
      const editor = workbench.locator("iframe#editor").contentFrame();
      await expect
        .poll(() => editor.locator("body").evaluate(() => window.bento?.read()?.slides?.length))
        .toBe(4);
    } else if (app === "images") {
      const image = workbench.locator("#stage img");
      await expect
        .poll(() => image.evaluate((el) => el.complete && el.naturalWidth))
        .toBeGreaterThan(0);
      await workbench.locator("#ideas button").first().click();
      await expect(workbench.locator("#prompt")).not.toHaveValue("");
    } else {
      await workbench.locator("[data-ticket]").first().click();
      await expect(workbench.locator("#messages")).toContainText("sidebar");
    }
    await expect(page.getByRole("button", { name: "Play demo", exact: true })).toBeVisible();
    await catalog.click();
    await expect(frame.locator('li[data-app="' + id + '"]')).toBeVisible();
  }
  await expect(page).toHaveURL(/\/$/);
});

test("keeps the visitor's draft on keyboard takeover and replays only on request", async ({
  page,
}) => {
  const { frame, iframe } = await openHero(page, "en");
  const play = page.getByRole("button", { name: "Play demo", exact: true });
  const stop = page.getByRole("button", { name: "Stop demo", exact: true });
  const draft = frame.locator(composer);
  await expect(draft).not.toHaveValue("");
  // An unrelated message, a synthetic click and a hover cannot take the demo over.
  await page.evaluate(() =>
    window.postMessage("penguin:homepage-demo-taken-over", location.origin),
  );
  await draft.evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await draft.hover();
  await expect(stop).toBeVisible();
  // Focus the document via plain content, then enter text without clicking the control.
  await frame.getByRole("heading", { name: "PenguinHarness", exact: true }).click();
  await draft.focus();
  await page.keyboard.type("A visitor's draft");
  await expect(play).toBeVisible();
  await expect(draft).toBeFocused();
  const typed = await draft.inputValue();
  expect(typed).toContain("A visitor's draft");
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.clock.runFor(1000);
  await iframe.scrollIntoViewIfNeeded();
  await page.clock.fastForward(60_000);
  await expect(draft).toHaveValue(typed);
  await play.click();
  await expect(stop).toBeVisible();
  await expect(draft).not.toHaveValue(typed);
  await expect(draft).not.toHaveValue("");
});

test("selecting the scripted draft from the keyboard preserves the visitor's selection", async ({
  page,
}) => {
  const { frame } = await openHero(page, "en");
  const draft = frame.locator(composer);
  await expect(draft).not.toHaveValue("");
  await frame.getByRole("heading", { name: "PenguinHarness", exact: true }).click();
  await draft.focus();
  await page.keyboard.press("Control");
  await expect(page.getByRole("button", { name: "Stop demo", exact: true })).toBeVisible();
  await draft.press("ControlOrMeta+a");
  const selection = () =>
    draft.evaluate((field) => ({
      text: field.value,
      start: field.selectionStart,
      end: field.selectionEnd,
    }));
  const selected = await selection();
  expect(selected.text.length).toBeGreaterThan(0);
  expect(selected).toMatchObject({ start: 0, end: selected.text.length });
  await expect(page.getByRole("button", { name: "Play demo", exact: true })).toBeVisible();
  await page.clock.fastForward(60_000);
  expect(await selection()).toEqual(selected);
});

test("a keyboard-activated navigation link keeps its destination while the scripted reply stops", async ({
  page,
}) => {
  const { frame } = await openHero(page, "en");
  const stop = frame.getByRole("button", { name: "Stop", exact: true });
  for (let step = 0; step < 12 && !(await stop.first().isVisible()); step++)
    await page.clock.runFor(500);
  await expect(stop.first()).toBeVisible();
  const apps = frame.locator('a[href="/apps"]:visible').first();
  await frame.locator("main").click({ position: { x: 2, y: 2 } });
  await apps.focus();
  await apps.press("Enter");
  await expect(page.getByRole("button", { name: "Play demo", exact: true })).toBeVisible();
  const tile = frame.locator('li[data-app="system_agent/benchmark"] > button');
  await expect(tile).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(tile).toBeVisible();
  await expect(frame.getByRole("heading", { name: "Docs QA v1", exact: true })).toHaveCount(0);
});

test("taking over the split preview releases the scripted drag", async ({ page }) => {
  const { frame } = await openHero(page, "en");
  await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 250).toISOString()));
  const results = frame.locator('[data-workspace-page^="chat:"][data-pane] table:visible').first();
  for (let step = 0; step < 140 && !(await results.isVisible()); step++)
    await page.clock.runFor(450);
  await expect(results).toBeVisible();
  const tile = frame.locator('li[data-app="system_agent/benchmark"] > button:visible');
  for (let step = 0; step < 150 && !(await tile.isVisible()); step++) await page.clock.runFor(30);
  await expect(tile).toBeVisible();
  const preview = frame.locator("[data-pane=full] .z-drag-preview");
  for (let step = 0; step < 150 && !(await preview.isVisible()); step++)
    await page.clock.runFor(30);
  await expect(preview).toBeVisible();
  const apps = frame.locator('a[href="/apps"]:visible').first();
  await apps.click();
  await expect(page.getByRole("button", { name: "Play demo", exact: true })).toBeVisible();
  await page.clock.fastForward(1500);
  await expect(tile).toBeVisible();
  await expect(frame.locator("[data-page-viewport]")).not.toHaveClass(/pointer-events-none/);
  await expect(frame.locator(".z-drag-preview")).toHaveCount(0);
});

test.describe("starting the demo on a touchscreen", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("a swipe leaves playback alone and tapping the composer keeps the same page", async ({
    page,
  }) => {
    const { iframe, frame } = await openHero(page, "en");
    const stop = page.getByRole("button", { name: "Stop demo", exact: true });
    const draft = frame.locator(composer);
    await expect(draft).toBeVisible();
    await iframe.scrollIntoViewIfNeeded();
    await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 50).toISOString()));
    const scrollEnd = page.evaluate(
      () =>
        new Promise((resolve) =>
          document.addEventListener("scrollend", () => resolve(), { capture: true, once: true }),
        ),
    );
    const box = await iframe.boundingBox();
    const touch = await page.context().newCDPSession(page);
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - 70 }],
    });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await touch.detach();
    await scrollEnd;
    await expect(stop).toBeVisible();
    // A swipe can leave the scaled input behind the site's sticky header. Tap a point that
    // actually hits the composer in the guest and its iframe in the outer page.
    const composerPoint = () =>
      iframe.evaluate((guest, selector) => {
        const doc = guest.contentDocument;
        const input = doc.querySelector(selector);
        const field = input.getBoundingClientRect();
        const insideX = field.left + field.width / 2;
        const insideY = field.top + field.height / 2;
        const frame = guest.getBoundingClientRect();
        const x = frame.left + (insideX * frame.width) / guest.clientWidth;
        const y = frame.top + (insideY * frame.height) / guest.clientHeight;
        return {
          x,
          y,
          visible:
            document.elementFromPoint(x, y) === guest &&
            doc.elementFromPoint(insideX, insideY) === input,
        };
      }, composer);
    const target = await composerPoint();
    await page.evaluate(
      (y) => scrollBy({ top: y - innerHeight / 2, behavior: "instant" }),
      target.y,
    );
    await expect.poll(async () => (await composerPoint()).visible).toBe(true);
    const { x: tapX, y: tapY } = await composerPoint();
    await page.touchscreen.tap(tapX, tapY);
    // Chromium delivers the compatibility click after the touch sequence.
    await page.clock.runFor(500);
    await expect(page.getByRole("button", { name: "Play demo", exact: true })).toBeVisible();
    await expect(draft).toBeFocused();
    await draft.fill("Touch draft");
    await page.clock.fastForward(60_000);
    await expect(draft).toHaveValue("Touch draft");
  });

  for (const reducedMotion of ["no-preference", "reduce"]) {
    test(`reveals the demo on the first tap (${reducedMotion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(() => localStorage.setItem("penguin-site.lang", "en"));
      await page.goto("/");
      const play = page.getByRole("button", { name: "Play demo", exact: true });
      const stop = page.getByRole("button", { name: "Stop demo", exact: true });
      const iframe = page.locator('iframe[src*="fresh=1"]');
      if (reducedMotion === "no-preference") {
        await stop.tap();
        await expect(iframe.contentFrame().locator(composer)).toHaveValue("");
      }
      // A reader can reach Play at the bottom edge before any of the app has come into view.
      await play.evaluate((el) =>
        window.scrollTo({
          top: scrollY + el.getBoundingClientRect().bottom - innerHeight + 1,
          behavior: "instant",
        }),
      );
      const visibleFraction = () =>
        iframe.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const visible = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
          return visible / rect.height;
        });
      // With the gallery immediately below the compact heading, the page can already be
      // scrolled to the top before the toolbar reaches the bottom edge.
      if ((await page.evaluate(() => scrollY)) > 0) expect(await visibleFraction()).toBe(0);
      await play.tap();
      await expect.poll(visibleFraction).toBeGreaterThan(0.5);
      await expect(stop).toBeInViewport({ ratio: 1 });
      await expect(iframe.contentFrame().locator(composer)).not.toHaveValue("");
      await stop.tap();
      await expect(iframe.contentFrame().locator(composer)).toHaveValue("");
      await expect(iframe.contentFrame().getByRole("dialog")).toHaveCount(0);
    });
  }
});

test("waits for explicit playback with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { frame } = await openHero(page);
  await page.clock.fastForward(30_000);
  await expect(frame.locator(composer)).toHaveValue("");
  await page.getByRole("button", { name: "播放演示", exact: true }).click();
  await expect(frame.locator(composer)).not.toHaveValue("");
  await page.getByRole("button", { name: "停止演示", exact: true }).click();
  await expect(frame.locator(composer)).toHaveValue("");
});

test("pauses and resumes the AMSP stream with the shared control", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("penguin-site.lang", "zh"));
  await page.clock.install({ time: new Date("2026-10-28T00:00:00Z") });
  await page.goto("/amsp");
  const pause = page.getByRole("button", { name: "暂停", exact: true });
  await pause.scrollIntoViewIfNeeded();
  await page.clock.runFor(1200);
  await pause.click();
  const stream = page.locator('[role="tabpanel"] ol:visible');
  const before = await stream.allTextContents();
  await page.clock.fastForward(15_000);
  expect(await stream.allTextContents()).toEqual(before);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.clock.runFor(1200);
  expect(await stream.allTextContents()).not.toEqual(before);
});
