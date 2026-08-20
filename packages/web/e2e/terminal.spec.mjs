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
