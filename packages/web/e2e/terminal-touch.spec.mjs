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

/**
 * One finger dragged down the middle of the screen, from one fraction of its height to
 * another. Through CDP because that is the only way to produce touches a page cannot tell
 * from a real one — Playwright's own touchscreen taps and nothing more, and a hand-built
 * TouchEvent skips the hit testing and the `touch-action` the gesture depends on.
 */
async function dragFinger(page, from, to) {
  const box = await page.locator(".xterm-screen").boundingBox();
  const x = box.x + box.width / 2;
  const y = (fraction) => box.y + box.height * fraction;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: y(from) }],
  });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y(from + ((to - from) * i) / steps) }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
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

  test("a finger scrolls a program that has taken the mouse", async ({ page }) => {
    await provisionAndLogin(page.request, U, P);
    await killAllTerminals(page.request);
    await page.goto(`${BASE}/terminal`);
    await waitForShell(page, "TOUCH_UP_2");

    // A plain shell: the drag is xterm's own business. It still scrolls the scrollback — the
    // `touch-none` the host now carries must not take that away — and NOTHING may reach the
    // pty, since a wheel report typed at a prompt is a line of garbage.
    await type(page, "seq 1 300");
    await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("300");
    const scrollTop = () =>
      page.evaluate(() => document.querySelector(".xterm-viewport").scrollTop);
    const atBottom = await scrollTop();
    await dragFinger(page, 0.3, 0.8);
    await expect.poll(scrollTop, { timeout: 10000 }).toBeLessThan(atBottom);
    await expect(page.locator(".xterm-rows")).not.toContainText("[<");

    // The arrangement a TUI uses, Claude Code included: the alternate screen (no scrollback
    // left to scroll) plus any-event mouse tracking in SGR. `cat -v` then prints what the
    // program would have received, so the reports the finger produces are on the screen.
    await type(
      page,
      String.raw`printf '\033[?1049h\033[?1000h\033[?1002h\033[?1003h\033[?1006h'; cat -v`,
    );
    await expect
      .poll(() => page.evaluate(() => document.querySelector(".xterm")?.className ?? ""), {
        timeout: 15000,
      })
      .toContain("enable-mouse-events");

    // Up the screen: later content, which is a wheel rolled down — button 65.
    await dragFinger(page, 0.7, 0.3);
    await expect.poll(() => screenText(page), { timeout: 15000 }).toMatch(/\[<65;\d+;\d+M/);
    // And back down: earlier content, button 64.
    await dragFinger(page, 0.3, 0.7);
    await expect.poll(() => screenText(page), { timeout: 15000 }).toMatch(/\[<64;\d+;\d+M/);
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
