/**
 * The terminal under a finger: a phone's soft keyboard has no Esc, no Tab, no arrows and no
 * Ctrl, so the key bar is the only way to drive a shell there. What matters is that its caps
 * reach the real pty — an arrow that types `[A` into the prompt, or a Ctrl that never
 * composes, looks like a working button and is not one — and that none of it appears where a
 * physical keyboard already exists.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const U = "touchuser";
const P = "password123";

/** Live shells accumulate across spec reruns on one server; MAX 12/user would 429. */
async function killAllTerminals(request) {
  const { terminals } = await (await request.get(`${BASE}/api/terminals`)).json();
  for (const t of terminals) await request.delete(`${BASE}/api/terminals/${t.id}`);
}

const screenText = (page) => page.locator(".xterm-rows").innerText();

/** A tap on the screen focuses xterm, which is what raises the soft keyboard. */
async function focusShell(page) {
  await page.locator(".xterm-screen").click();
}

async function type(page, command) {
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

/**
 * "ready" only means the stream is attached; a login shell may still be sourcing profiles,
 * and input typed meanwhile sits in the tty buffer until it wakes up. Probe with a sentinel.
 */
async function waitForShell(page, tag) {
  await expect(page.locator(".xterm-rows")).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="terminal-status"][data-status="ready"]')).toBeVisible({
    timeout: 20000,
  });
  await focusShell(page);
  await type(page, `echo ${tag.slice(0, 2)}''${tag.slice(2)}`);
  await expect.poll(() => screenText(page), { timeout: 30000 }).toMatch(new RegExp(`${tag}$`, "m"));
}

test.describe("touch", () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  test("the key bar drives the shell: history, interrupt, and a sticky Ctrl", async ({ page }) => {
    await provisionAndLogin(page.request, U, P);
    await killAllTerminals(page.request);
    await page.goto(`${BASE}/terminal`);
    await waitForShell(page, "TOUCH_UP_1");

    const bar = page.getByTestId("terminal-key-bar");
    await expect(bar).toBeVisible();

    // The keyboard cap is a toggle over xterm's focus: it dismisses the soft keyboard
    // (which a phone otherwise leaves covering half the screen) and calls it back.
    const keyboardCap = page.getByTestId("terminal-key-keyboard");
    await expect(keyboardCap).toHaveAccessibleName(/收起键盘/);
    await keyboardCap.click();
    await expect(keyboardCap).toHaveAccessibleName(/调出键盘/);
    await keyboardCap.click();
    await expect(keyboardCap).toHaveAccessibleName(/收起键盘/);

    // ↑ recalls the previous command. A CSI arrow reaching a shell that asked for SS3 would
    // land as literal text instead, which is exactly what this catches.
    await type(page, "echo HISTORY_ONE");
    await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("HISTORY_ONE");
    await page.getByTestId("terminal-key-up").click();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => screenText(page).then((t) => t.split("HISTORY_ONE").length - 1), {
        timeout: 15000,
      })
      // The command echo and its output, twice over: four occurrences, not two.
      .toBeGreaterThanOrEqual(4);

    // ^C on a shell that is busy: without it the prompt would not come back for 45 seconds.
    await type(page, "sleep 45");
    await page.getByTestId("terminal-key-interrupt").click();
    await type(page, "echo AFTER_INTERRUPT");
    await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("AFTER_INTERRUPT");

    // The sticky modifier: arm Ctrl on the bar, then the next character typed on the
    // keyboard composes with it (this is the path a soft keyboard's "c" takes).
    await type(page, "sleep 45");
    const ctrl = page.getByTestId("terminal-key-ctrl");
    await ctrl.click();
    await expect(ctrl).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.type("c");
    await expect(ctrl).toHaveAttribute("aria-pressed", "false"); // spent
    await type(page, "echo AFTER_STICKY_CTRL");
    await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("AFTER_STICKY_CTRL");
  });
});

test("no key bar where there is a real keyboard", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/terminal`);
  await expect(page.locator('[data-testid="terminal-status"][data-status="ready"]')).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId("terminal-key-bar")).toHaveCount(0);
});
