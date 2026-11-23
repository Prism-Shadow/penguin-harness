/**
 * A work group keeps its paper outline when its head folds. A password reminder opens a
 * bordered dialog, including from the account settings; neighbouring settings rows share
 * their outer edge and their dividers. Check the paint rather than a particular CSS rule.
 */
import { expect, test } from "@playwright/test";
import { contrastRatio, parseColor } from "../../ui/src/testing/color.ts";

async function expectCaptionInk(text, paper) {
  const ink = parseColor(await text.evaluate((el) => getComputedStyle(el).color));
  const stock = parseColor(await paper.evaluate((el) => getComputedStyle(el).backgroundColor));
  expect(contrastRatio(ink, stock), "small text against its paper").toBeGreaterThanOrEqual(4.5);
}

async function expectPaperEdge(page, surface, stroke = surface) {
  await expect(surface).toBeVisible();
  const { edge, radius } = await stroke.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      edge: style.borderLeftColor,
      radius: Math.max(
        ...[
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomLeftRadius,
          style.borderBottomRightRadius,
        ].map(parseFloat),
      ),
    };
  });
  const png = await surface.screenshot({ animations: "disabled", scale: "css" });
  const sides = await page.evaluate(
    async ({ png, edge, radius }) => {
      const image = await createImageBitmap(
        await (await fetch("data:image/png;base64," + png)).blob(),
      );
      const { width, height } = image;
      const ctx = new OffscreenCanvas(width, height).getContext("2d");
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, 1, 1);
      const ink = ctx.getImageData(0, 0, 1, 1).data;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const matches = (x, y) => {
        const offset = 4 * (y * width + x);
        return (
          ink[3] === 255 && [0, 1, 2].every((c) => Math.abs(pixels[offset + c] - ink[c]) <= 14)
        );
      };
      // A fractional layout box can round either way when the browser crops the screenshot.
      // Sample one to three device pixels inside the long straight portion of each edge.
      return ["top", "right", "bottom", "left"].map((side) => {
        const horizontal = side === "top" || side === "bottom";
        const length = horizontal ? width : height;
        const fractions = length >= 4 * radius ? [0.25, 0.5, 0.75] : [0.5];
        return fractions.every((fraction) => {
          const line = Math.floor(length * fraction);
          return [0, 1, 2].some((depth) =>
            horizontal
              ? matches(line, side === "top" ? depth : height - 1 - depth)
              : matches(side === "left" ? depth : width - 1 - depth, line),
          );
        });
      });
    },
    { png: png.toString("base64"), edge, radius },
  );
  expect(sides, "painted top, right, bottom and left borders").toEqual([true, true, true, true]);
}

for (const [mode, lang, width] of [
  ["light", "en", 1280],
  ["dark", "zh", 390],
]) {
  test(`Doodle retains the notebook edge and the password and settings outlines (${mode})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    const prefs = new URLSearchParams({ theme: "doodle", mode, lang });
    await page.goto(`/app.html?route=/chat/s-link-check&${prefs}`);
    const frame = page
      .locator(".ui-frame")
      .filter({ has: page.locator('[data-group-header][data-state="running"]') })
      .first();
    const head = frame.locator("[data-group-header]");
    await expect(head).toHaveCSS(
      "background-color",
      await frame.evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await expectPaperEdge(page, frame, head);
    await expectCaptionInk(head.locator('[data-slot="detail"]:visible').first(), head);
    await head.focus();
    await head.press("Enter");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expectPaperEdge(page, frame, head);

    await page.goto(`/app.html?route=/chat/new&notices=1&${prefs}`);
    const banner = page.locator(".ui-notice[data-banner]").first();
    await expectPaperEdge(page, banner);
    await banner.getByRole("button", { name: lang === "en" ? "Change now" : "去修改" }).click();
    const password = page.getByRole("dialog");
    await expectPaperEdge(page, password);
    const field = password.locator('input[type="password"]').first();
    for (let i = 0; i < 8 && !(await field.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(field).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(password).toHaveCount(0);

    await page.goto(`/app.html?route=/chat/new&open=settings.general&${prefs}`);
    const firstRow = page.locator(".ui-field").first();
    await expectPaperEdge(page, firstRow.locator(".."), firstRow);

    await page.goto(`/app.html?route=/chat/s-harness-rows&${prefs}`);
    const skill = page
      .locator('p.ui-activity[data-kind="event"]')
      .filter({ hasText: /Using skills?|使用技能/i })
      .first();
    await expectPaperEdge(page, skill.locator(".."), skill);
    await page.goto(`/app.html?route=/models&${prefs}`);
    const group = page.locator('.ui-library [data-slot="group"]').first();
    const groupHead = group.locator('[data-slot="head"]').first();
    await expect(groupHead).toHaveCSS(
      "background-color",
      await group.evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await expectCaptionInk(groupHead.locator('[data-slot="count"]'), groupHead);
    const card = group.locator('[data-slot="card"]').first();
    await expectCaptionInk(card.locator('[data-slot="meta"]').last(), card);
  });
}

test("Doodle keeps the fold's perimeter in place while the sheet closes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/app.html?route=/chat/s-link-check&theme=doodle&mode=light&lang=zh");
  const header = page.locator('[data-group-header][data-state="running"]').first();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  const phases = await header.evaluate(async (button) => {
    const frame = button.closest(".ui-frame");
    const samples = [];
    button.click();
    for (let i = 0; i < 128; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const body = frame.querySelector(":scope > [data-fold]");
      const border = getComputedStyle(frame);
      samples.push({
        phase: body?.dataset.fold ?? "closed",
        stroke: [
          getComputedStyle(frame.querySelector(':scope > [data-slot="head"]')).borderTopWidth,
          border.borderRightWidth,
          border.borderBottomWidth,
          border.borderLeftWidth,
        ],
      });
      if (!body) break;
    }
    return samples;
  });
  expect(phases.some((sample) => sample.phase === "closing")).toBe(true);
  expect(phases.at(-1).phase).toBe("closed");
  expect(phases.every((sample) => sample.stroke.every((width) => parseFloat(width) === 2))).toBe(
    true,
  );
});

for (const [lang, mode, width] of [
  ["zh", "light", 1280],
  ["en", "dark", 390],
]) {
  test(`Doodle shuffles suggested prompts without changing the draft (${lang})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`/app.html?route=/chat/new&theme=doodle&mode=${mode}&lang=${lang}`);
    const box = page.locator('.ui-start [data-slot="examples"]');
    const examples = box.locator('[data-slot="suggestion"]');
    const first = examples.first();
    // Suggestions accept keyboard focus after the Agent’s Skills have loaded.
    await expect(first).toBeEnabled();
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-current", "true");
    const draft = page.locator(".ui-start textarea").first();
    const text = await draft.inputValue();
    expect(text).not.toBe("");
    const previous = await examples.allTextContents();
    await box.getByRole("button", { name: /Shuffle suggestions|换一组示例/ }).click();
    const next = await examples.allTextContents();
    expect(next.length).toBe(previous.length);
    expect(next.every((label) => !previous.includes(label))).toBe(true);
    await expect(draft).toHaveValue(text);
    await draft.fill(text + "!");
    await expect(box.locator('[aria-current="true"]')).toHaveCount(0);
    await examples.nth(1).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: /^(Cancel|取消)$/ }).click();
    await expect(box.locator('[aria-current="true"]')).toHaveCount(0);
  });
}
