/**
 * A paged dialog scrolls its page, never its rail. The dialogs board (`lib.html?topic=dialogs`)
 * opens its paged dialog on a page longer than the dialog, whose foot (`PagedDialogFoot`) holds
 * Save, as the Project settings' security page holds its pager and Save.
 *
 * - Given the page scrolled to its middle, the rail and the pane heading stay where they were,
 *   and the foot sits whole at the dialog's bottom edge, over the rows scrolling beneath it.
 * - Given the page scrolled to its end, the foot rests below the last row: no row is left under it.
 * - Given a phone, where the dialog is a bottom sheet with the rail as a strip above the pane, the
 *   same holds.
 */
import { test, expect } from "@playwright/test";

async function openPaged(page, { width = 1280, height = 800 } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto("/lib.html?topic=dialogs&theme=modern&mode=light&lang=en");
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByRole("listitem")).toHaveCount(24);
  // The dialog rises into place as it opens: where its rail sits is read off the resting dialog.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  );
  return dialog;
}

/** Where the rail, the heading, the foot, the last row and the dialog sit, in client px. */
const layout = (dialog) =>
  dialog.evaluate((el) => {
    const pane = [...el.querySelectorAll("*")].find(
      (e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.querySelector("ul"),
    );
    const top = (e) => e.getBoundingClientRect().top;
    const save = [...el.querySelectorAll("button")].find((b) => b.textContent === "Save");
    const foot = save.parentElement.getBoundingClientRect();
    const rows = el.querySelectorAll("li");
    return {
      scrolls: pane.scrollHeight > pane.clientHeight,
      railTop: top(el.querySelector("nav")),
      headingTop: top(el.querySelector("h2")),
      footTop: foot.top,
      footBottom: foot.bottom,
      lastRowBottom: rows[rows.length - 1].getBoundingClientRect().bottom,
      dialogBottom: el.getBoundingClientRect().bottom,
    };
  });

/** Scrolls the pane (the scroller holding the page's rows) to a fraction of its way down. */
const scrollPane = (dialog, fraction) =>
  dialog.evaluate((el, f) => {
    const pane = [...el.querySelectorAll("*")].find(
      (e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.querySelector("ul"),
    );
    pane.scrollTop = (pane.scrollHeight - pane.clientHeight) * f;
  }, fraction);

for (const [name, size] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
]) {
  test(`${name}: the rail and the heading stay put while the page scrolls under the foot`, async ({
    page,
  }) => {
    const dialog = await openPaged(page, size);
    const before = await layout(dialog);
    expect(before.scrolls).toBe(true);

    await scrollPane(dialog, 0.5);
    const middle = await layout(dialog);
    expect(middle.railTop).toBe(before.railTop);
    expect(middle.headingTop).toBe(before.headingTop);
    // The foot is held at the dialog's bottom edge, the rows passing beneath it.
    expect(middle.footBottom).toBeLessThanOrEqual(middle.dialogBottom + 0.5);
    expect(middle.dialogBottom - middle.footBottom).toBeLessThan(40);
    expect(middle.lastRowBottom).toBeGreaterThan(middle.footTop);

    await scrollPane(dialog, 1);
    const end = await layout(dialog);
    expect(end.railTop).toBe(before.railTop);
    expect(end.lastRowBottom).toBeLessThanOrEqual(end.footTop + 0.5);
  });
}
