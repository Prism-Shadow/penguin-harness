/**
 * Test the pixels painted by real controls, including a theme's asymmetric corners. The
 * diagnostic ink changes colour only, so losing the clipping or hiding the fill both fail.
 */
import { expect, test } from "@playwright/test";

const ink = "rgb(0, 236, 112)";
const radii = [22, 13, 19, 10]; // top left, top right, bottom right, bottom left
const corners = radii.map((r) => r + "px").join(" ");

async function readPixels(page, png, inspect, options) {
  const raster = await page.evaluateHandle(async (encoded) => {
    const blob = await (await fetch("data:image/png;base64," + encoded)).blob();
    const image = await createImageBitmap(blob);
    const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d");
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, image.width, image.height);
  }, png.toString("base64"));
  try {
    return await raster.evaluate(inspect, options);
  } finally {
    await raster.dispose();
  }
}

async function checkInk(page, owner, info, expectedRadii = radii) {
  await owner.scrollIntoViewIfNeeded();
  const box = await owner.boundingBox();
  // Include the nearby canvas: an oversized moving child can cross a straight edge too.
  const x = Math.floor(box.x) - 4;
  const y = Math.floor(box.y) - 4;
  const clip = {
    x,
    y,
    width: Math.ceil(box.x + box.width) - x + 4,
    height: Math.ceil(box.y + box.height) - y + 4,
  };
  const png = await page.screenshot({ clip, animations: "disabled", scale: "css" });
  const sample = await readPixels(
    page,
    png,
    ({ data, width, height }, { radii, box }) => {
      let interior = 0;
      let beyond = 0;
      const escaped = [0, 0, 0, 0];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = 4 * (y * width + x);
          if (data[i] > 30 || data[i + 1] < 211 || Math.abs(data[i + 2] - 112) > 24) continue;
          const px = x + 0.5 - box.x,
            py = y + 0.5 - box.y;
          const left = px < box.width / 2,
            top = py < box.height / 2;
          const corner = top ? (left ? 0 : 1) : left ? 3 : 2;
          const r = radii[corner];
          const dx = Math.min(px, box.width - px),
            dy = Math.min(py, box.height - py);
          if (dx < -1.5 || dy < -1.5) {
            beyond++;
            continue;
          }
          // Leave a CSS pixel either side of the curve for fractional layout / rasterization.
          if (dx < r && dy < r && Math.hypot(r - dx, r - dy) > r + 1.5) escaped[corner]++;
          if (dx > r || dy > r || Math.hypot(r - dx, r - dy) < r - 1.5) interior++;
        }
      }
      return { interior, escaped, beyond };
    },
    { radii: expectedRadii, box: { ...box, x: box.x - x, y: box.y - y } },
  );
  if (sample.interior <= 50 || sample.beyond || sample.escaped.some(Boolean))
    await info.attach("rounded-surface", { body: png, contentType: "image/png" });
  expect(sample.interior, "the state actually paints its surface").toBeGreaterThan(50);
  expect(sample.beyond, "fill beyond the straight edges").toBe(0);
  expect(sample.escaped, "fill outside each contour").toEqual([0, 0, 0, 0]);
}

for (const [theme, mode] of [
  ["doodle", "light"],
  ["modern", "dark"],
]) {
  test(`the drop veil follows its open host in ${theme} ${mode}`, async ({ page }, info) => {
    await page.goto(`/lib.html?topic=files&lang=en&theme=${theme}&mode=${mode}`);
    const host = page
      .locator(".lib-box")
      .filter({ has: page.getByText("Drop files to attach", { exact: true }) });
    await expect(host).toBeVisible();
    await host.evaluate((box, corners) => {
      box.dataset.testPaper = "";
      box.style.borderRadius = corners;
      // Drop feedback can cover a pane that also owns an escaping popup or focus indicator.
      box.style.overflow = "visible";
      box.style.border = "0";
    }, corners);
    await page.addStyleTag({
      content: `[data-test-paper] > [aria-hidden] { background-color: ${ink} !important; }`,
    });
    await checkInk(page, host, info);
  });
}

for (const [theme, mode] of [
  ["doodle", "dark"],
  ["github", "light"],
]) {
  test(`welcome link hover and keyboard focus respect its themed cell in ${theme} ${mode}`, async ({
    page,
  }, info) => {
    await page.goto(`/app.html?route=/chat/new&lang=en&theme=${theme}&mode=${mode}`);
    const owner = page.locator('.ui-start [data-slot="count"]').nth(1);
    const link = page.getByRole("link", { name: /RSI algorithms/i });
    await expect(link).toBeVisible();
    await owner.evaluate((el, corners) => {
      el.style.borderRadius = corners;
    }, corners);
    await link.evaluate((el) => {
      el.dataset.testLink = "";
    });
    // A theme may give the interactive link a smaller curve than the cell that owns its fill.
    await page.addStyleTag({
      content: `
        [data-test-link]:is(:hover, :focus-visible) { background-color: ${ink} !important; }
        [data-test-link]:focus-visible { border-radius: 9px 12px 9px 11px !important; }
      `,
    });
    await link.hover();
    await checkInk(page, owner, info);
    // Move the pointer away so the keyboard fill is exercised on its own.
    await page.mouse.move(0, 0);
    await page.locator('.ui-start [data-slot="counts"] a').first().focus();
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    await checkInk(page, owner, info);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /^Plugins\b/, level: 1 })).toBeVisible();
  });
}

test("a bounded pseudo-element keeps the card's exterior shadow and its neighbour's open menu", async ({
  page,
}, info) => {
  await page.goto("/lib.html?topic=shape&theme=modern&mode=light&lang=en");
  const scene = page.locator(".gf-scene-modal");
  await expect(scene).toBeVisible();
  await scene.evaluate((el, corners) => {
    el.style.borderRadius = corners;
  }, corners);
  await page.addStyleTag({
    content: `
    .gf-scene-modal::after { content: ""; position: absolute; inset: 0; background: ${ink}; pointer-events: none; }
    .gf-scene-modal { box-shadow: 0 4px 0 rgb(26, 126, 252); }
  `,
  });
  await checkInk(page, scene, info);
  await expectExteriorInk(page, scene, [26, 126, 252]);

  const menu = page.locator(".gf-card .gf-menu");
  await menu.scrollIntoViewIfNeeded();
  expect(
    await menu.evaluate((el) => {
      const card = el.parentElement.getBoundingClientRect(),
        menu = el.getBoundingClientRect();
      const x = card.right + 3,
        y = menu.top + 12;
      return x < menu.right && el.contains(document.elementFromPoint(x, y));
    }),
    "the menu is reachable outside the card",
  ).toBe(true);
});

// Sample only the expected overhang, in the middle of the straight lower edge.
async function expectExteriorInk(page, owner, rgb) {
  await owner.scrollIntoViewIfNeeded();
  const bounds = await owner.boundingBox();
  const clip = {
    x: Math.ceil(bounds.x + bounds.width / 2 - 4),
    y: Math.ceil(bounds.y + bounds.height) + 1,
    width: 8,
    height: 3,
  };
  const png = await page.screenshot({ clip, scale: "css", animations: "disabled" });
  const pixels = await readPixels(
    page,
    png,
    ({ data }, rgb) => {
      let matching = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (rgb.every((v, c) => Math.abs(data[i + c] - v) < 24)) matching++;
      }
      return matching;
    },
    rgb,
  );
  expect(pixels, "the exterior decoration is still painted").toBeGreaterThan(5);
}

test("a keyboard-focused Doodle switch keeps its ring and moves the knob within its track", async ({
  page,
}, info) => {
  await page.goto("/lib.html?topic=pickers&theme=doodle&mode=light&lang=en");
  const toggle = page.getByRole("switch").first();
  await expect(toggle).toBeVisible();
  await page.addStyleTag({
    content: `[role=switch]:focus-visible { outline: 2px solid rgb(26,126,252) !important; outline-offset: 1px; }`,
  });
  await toggle.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  const knob = toggle.locator(":scope > span > span:last-child");
  // A theme may accent the thumb. Its shadow is internal to the track; the focus ring is not.
  await knob.evaluate((el, colour) => {
    el.style.backgroundColor = colour;
    el.style.boxShadow = `0 0 0 5px ${colour}`;
  }, ink);
  const state = await toggle.getAttribute("aria-checked");
  for (const value of [state, state === "true" ? "false" : "true"]) {
    if ((await toggle.getAttribute("aria-checked")) !== value) await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-checked", value);
    await expectExteriorInk(page, toggle, [26, 126, 252]);
    const track = await toggle.boundingBox();
    const cap = track.height / 2;
    await checkInk(page, toggle, info, [cap, cap, cap, cap]);
    await expect
      .poll(async () => {
        const [track, thumb] = await Promise.all([toggle.boundingBox(), knob.boundingBox()]);
        const center = thumb.x + thumb.width / 2;
        return (
          thumb.x >= track.x &&
          thumb.x + thumb.width <= track.x + track.width &&
          (value === "true"
            ? center > track.x + track.width / 2
            : center < track.x + track.width / 2)
        );
      })
      .toBe(true);
  }
});
