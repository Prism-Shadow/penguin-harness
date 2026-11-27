/**
 * The install button holds its box through an install, as only a real engine can measure: the
 * buttons board (`lib.html?topic=buttons`) shows one install button at rest, at each step of an
 * install (a staged bar along its edge) and failed, all given the same labels to hold room for.
 *
 * - Given those specimens at the small rung, every one is the same width and height: a button
 *   that becomes a progress control, or a failed one, moves nothing beside it.
 * - Each keeps its words on one line, and the bar of a running one lies inside its box.
 */
import { test, expect } from "@playwright/test";

test("an install button keeps one box from rest through every step", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/lib.html?topic=buttons&theme=modern&mode=light&lang=en`);
  const buttons = page.locator("[data-install-button]");
  await expect(buttons.first()).toBeVisible();
  const boxes = await buttons.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const bar = el.querySelector('[role="progressbar"]')?.getBoundingClientRect() ?? null;
      const label = el.querySelector("span.grid > span");
      const range = document.createRange();
      range.selectNodeContents(label);
      const lines = new Set([...range.getClientRects()].map((b) => Math.round(b.top))).size;
      return {
        size: el.className.includes("text-sm") ? "md" : "sm",
        width: Math.round(r.width),
        height: Math.round(r.height),
        lines,
        barInside:
          bar === null || (bar.left >= r.left && bar.right <= r.right && bar.bottom <= r.bottom),
      };
    }),
  );
  const small = boxes.filter((b) => b.size === "sm" && b.width > 0);
  expect(small.length).toBeGreaterThanOrEqual(5);
  expect(new Set(small.map((b) => b.width)).size, "one width").toBe(1);
  expect(new Set(small.map((b) => b.height)).size, "one height").toBe(1);
  for (const b of boxes) {
    expect(b.lines).toBe(1);
    expect(b.barInside).toBe(true);
  }
});
