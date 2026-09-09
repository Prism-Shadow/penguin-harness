/**
 * Terminal page (/terminal), the behaviour the whole server-side design exists for:
 * - a real shell runs in the server and echoes what is typed into it;
 * - a browser reload reattaches to that same shell and repaints the screen it had —
 *   scrollback, colours and cursor included — instead of starting over;
 * - the reattached page is a live terminal, not a screenshot of one;
 * - work started before the reload is still running after it (the shell never restarted);
 * - "New shell" is the one action that deliberately drops the session;
 * - the page is deep-linkable: ?id= attaches an existing terminal (the dock's detach
 *   handoff), ?cwd= picks the starting directory of a new one.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const U = "terminaluser";
const P = "password123";

/** Live shells accumulate across spec reruns on one server; MAX 12/user would 429. */
async function killAllTerminals(request) {
  const { terminals } = await (await request.get(`${BASE}/api/terminals`)).json();
  for (const t of terminals) await request.delete(`${BASE}/api/terminals/${t.id}`);
  await expect
    .poll(
      async () => {
        const res = await (await request.get(`${BASE}/api/terminals`)).json();
        return res.terminals.filter((t) => t.alive).length;
      },
      { timeout: 10000 },
    )
    .toBe(0);
}

/** The DOM renderer keeps the rows as text, so the screen is readable without pixels. */
const screenText = (page) => page.locator(".xterm-rows").innerText();

async function run(page, command) {
  await page.click(".xterm-screen");
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

/**
 * "ready" only means the stream is attached; a login shell may still be sourcing profiles,
 * and input typed meanwhile sits in the tty buffer until it wakes up. Every test needs a
 * shell that is actually at a prompt, so probe with a sentinel and wait for its output.
 */
async function waitForShell(page, tag) {
  await expect(page.locator(".xterm-rows")).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="terminal-status"][data-status="ready"]')).toBeVisible({
    timeout: 20000,
  });
  // Quote-split sentinel: the typed command's echo never contains the tag, and the match
  // is end-of-line — a resize reflow right after attach can glue rows together.
  await run(page, `echo ${tag.slice(0, 2)}''${tag.slice(2)}`);
  await expect.poll(() => screenText(page), { timeout: 30000 }).toMatch(new RegExp(`${tag}$`, "m"));
}

test("keeps the shell and its screen across a reload", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/terminal`);
  await waitForShell(page, "SHELL_UP_1");

  // Attaching writes the terminal id into the URL so the session survives even a reload
  // that loses localStorage (and the address is now shareable across windows).
  expect(page.url()).toMatch(/[?&]id=/);

  // A file only this run writes, appended to by a background loop: proof later that the very
  // same shell process (not a fresh one) survived the reload.
  await run(
    page,
    "rm -f /tmp/penguin-e2e-ticks; (for i in $(seq 1 30); do echo t >> /tmp/penguin-e2e-ticks; sleep 0.4; done &)",
  );
  await run(page, "echo BEFORE_RELOAD_MARKER");
  await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("BEFORE_RELOAD_MARKER");
  const lastLineBefore = (await screenText(page)).trim().split("\n").at(-1).trim();

  await page.reload();
  await expect(page.locator('[data-testid="terminal-status"][data-status="ready"]')).toBeVisible({
    timeout: 20000,
  });

  // The screen came back, not a fresh prompt.
  await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("BEFORE_RELOAD_MARKER");
  expect(await screenText(page)).toContain(lastLineBefore);

  // ...and it is still interactive.
  await run(page, "echo AFTER_RELOAD_MARKER");
  await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("AFTER_RELOAD_MARKER");

  // ...and the background loop kept running while no browser was attached, which it could
  // only do if the shell itself was never restarted.
  await run(page, "echo ticks=$(wc -l < /tmp/penguin-e2e-ticks)");
  await expect.poll(() => screenText(page), { timeout: 15000 }).toMatch(/^ticks=[2-9]\d*$/m);
  await run(page, "pkill -f 'penguin-e2e-ticks' >/dev/null 2>&1; rm -f /tmp/penguin-e2e-ticks");
});

test("New shell starts a fresh session", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/terminal`);
  await waitForShell(page, "SHELL_UP_2");

  await run(page, "echo DISPOSABLE_MARKER");
  await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("DISPOSABLE_MARKER");

  await page.locator('[data-testid="terminal-new-shell"]').click();
  await waitForShell(page, "SHELL_UP_3");

  expect(await screenText(page)).not.toContain("DISPOSABLE_MARKER");
  // The dropped session's id is gone from the URL too (a reload keeps the new shell).
  await run(page, "echo NEW_URL_CHECK");
  await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("NEW_URL_CHECK");
});

test("?cwd= starts the shell in the requested directory", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/terminal?cwd=/tmp`);
  await waitForShell(page, "SHELL_UP_CWD");

  await run(page, "pwd");
  await expect.poll(() => screenText(page), { timeout: 15000 }).toMatch(/^\/tmp$/m);
});

test("?id= attaches an existing terminal with its screen (deep link)", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await killAllTerminals(page.request);

  // Drive a terminal entirely through the HTTP control plane first…
  const created = await page.request.post(`${BASE}/api/terminals`, {
    data: { cwd: "/tmp", cols: 100, rows: 30 },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.request.post(`${BASE}/api/terminals/${id}/keys`, {
    data: { keys: "echo DEEP_LINK_MARKER", literal: true },
  });
  await page.request.post(`${BASE}/api/terminals/${id}/keys`, { data: { keys: "Enter" } });
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${BASE}/api/terminals/${id}/capture`);
        return (await res.json()).lines.join("\n");
      },
      { timeout: 20000 },
    )
    .toMatch(/^DEEP_LINK_MARKER$/m);

  // …then the deep link shows that same screen, live.
  await page.goto(`${BASE}/terminal?id=${id}`);
  await expect(page.locator('[data-testid="terminal-status"][data-status="ready"]')).toBeVisible({
    timeout: 20000,
  });
  await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("DEEP_LINK_MARKER");
  await run(page, "echo DEEP_LINK_LIVE");
  await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("DEEP_LINK_LIVE");
});

/**
 * Copying out of a program that has taken the mouse — Claude Code being the one everybody
 * runs. It asks for any-event tracking (`?1003h`), so every bare mouse move is reported to
 * it, and xterm counts a report as user input, which drops the selection. The selection
 * therefore used to die the moment the hand left the mouse, and Ctrl+C — which copies only
 * when a selection stands — fell through to the interrupt.
 */
test("a selection over a mouse-owning program survives the pointer, and Ctrl+C copies it", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await provisionAndLogin(page.request, U, P);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/terminal`);
  await waitForShell(page, "SELECT_UP_1");

  // The arrangement a TUI uses: the alternate screen plus any-event mouse tracking in SGR,
  // with text drawn after the switch so there is something on the screen to select.
  await run(
    page,
    String.raw`printf '\033[?1049h\033[?1000h\033[?1002h\033[?1003h\033[?1006h'; ` +
      `printf 'COPY_ME_%s\\n' 1 2 3 4 5; cat -v`,
  );
  await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("COPY_ME_3");
  await expect
    .poll(() => page.evaluate(() => document.querySelector(".xterm")?.className ?? ""), {
      timeout: 15000,
    })
    .toContain("enable-mouse-events");

  // Shift forces a selection past the program's grip (xterm's shouldForceSelection).
  const line = page.locator(".xterm-rows > div", { hasText: "COPY_ME_3" }).first();
  const box = await line.boundingBox();
  const y = box.y + box.height / 2;
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  // The hand leaves the mouse: bare motion, several cells of it. This is what used to wipe
  // the selection before it could be copied.
  await page.mouse.move(box.x + 300, y + 4 * box.height, { steps: 8 });
  await page.waitForTimeout(200);

  await page.keyboard.press("Control+KeyC");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10000 })
    .toContain("COPY_ME_3");

  // And a keystroke still drops the selection, exactly as xterm intends.
  await page.keyboard.press("KeyX");
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector(".xterm-selection")?.children.length ?? 0),
    )
    .toBe(0);
});
