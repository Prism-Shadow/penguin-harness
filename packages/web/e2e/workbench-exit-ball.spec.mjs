/**
 * The full-page workbench's exit ball (features/workbenches/exit-ball.tsx, drawn and moved by the
 * UI package's FloatingBall), on the shipped Support workbench as the admin opens it (locale en).
 * The drag is a real mouse travelling over the workbench's iframe, which is what the ball's
 * shield exists for.
 *
 * - The ball rests in the bottom-right corner. Dragged across the page to its left half, it does
 *   not exit and comes to rest against the left edge; a reload keeps it there.
 * - Hovering the ball shows its tuck button; a click puts the ball away into a handle on the left
 *   edge, and a reload keeps it tucked. Tucked, the command palette still offers the exit.
 * - The handle brings the ball back, and Enter on the ball leaves the full page.
 */
import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL;
const FULL_PAGE = `${BASE}/app/default_project/penguin_support/support`;

async function openFullPage(page) {
  await expect(page.locator("iframe")).toBeVisible({ timeout: 30_000 });
}

test("the exit ball drags to the other edge, tucks away and comes back, and still exits", async ({
  page,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  await page.goto(FULL_PAGE);
  await openFullPage(page);
  const { width, height } = page.viewportSize();
  const ball = page.getByRole("button", { name: "Exit full screen", exact: true });
  const handle = page.getByRole("button", { name: "Show the exit button", exact: true });

  const resting = await ball.boundingBox();
  expect(resting.x + resting.width).toBeGreaterThan(width - 40);
  expect(resting.y + resting.height).toBeGreaterThan(height - 40);

  await page.mouse.move(resting.x + resting.width / 2, resting.y + resting.height / 2);
  await page.mouse.down();
  await page.mouse.move(width * 0.3, height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(page).toHaveURL(FULL_PAGE);
  await expect.poll(async () => (await ball.boundingBox())?.x).toBeLessThan(40);
  const onLeft = await ball.boundingBox();
  expect(onLeft.x).toBeGreaterThan(0);
  expect(Math.abs(onLeft.y + onLeft.height / 2 - height / 2)).toBeLessThan(24);

  await page.reload();
  await openFullPage(page);
  await expect.poll(async () => (await ball.boundingBox())?.x).toBeLessThan(40);

  await ball.hover();
  const tuck = page.getByRole("button", { name: "Tuck to the edge", exact: true });
  await expect(tuck).toHaveCSS("opacity", "1");
  await tuck.click();
  await expect(ball).toHaveCount(0);
  await expect(handle).toBeVisible();
  expect((await handle.boundingBox()).x).toBe(0);

  await page.reload();
  await openFullPage(page);
  await expect(handle).toBeVisible();
  await expect(ball).toHaveCount(0);

  await page.keyboard.press("Control+Shift+KeyP");
  await expect(page.getByPlaceholder("Type to filter commands…")).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Exit full page (back to workbench)", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await handle.click();
  await expect(handle).toHaveCount(0);
  await ball.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/new$/);
});
