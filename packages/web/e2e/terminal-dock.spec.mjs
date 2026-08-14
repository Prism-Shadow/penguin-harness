/**
 * In-app terminal dock (the Codex-style integrated terminal) and the chat toolbar's panel
 * switcher:
 * - Ctrl+` toggles a terminal panel at the bottom of the app;
 * - the shell keeps running while the dock is closed; reopening reattaches to it;
 * - "Detach" hands the terminal off to /terminal?id=… in a new window — same shell, same
 *   screen — and the dock forgets it, so its next shell is a fresh one;
 * - the chat toolbar (top-right) shows icon-only triggers for the pinned panels plus an
 *   "all panels" dropdown (智能体面板 / 终端 / 工作区) with per-panel pin toggles that
 *   persist; agents + workspace are pinned by default, the terminal is opt-in.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "dockuser";
const P = "password123";

/**
 * A Project without model credentials pops the onboarding overlay (fixed inset-0) as soon
 * as /chat loads, which would swallow every click on the dock; configure the mock model
 * first, like the other app-shell specs do.
 */
async function configureProjectModel(request) {
  const projectId = (await (await request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
  const put = await request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();
  return projectId;
}

/** The chat toolbar only renders on a real Session, so make one through the API. */
async function createSession(request, projectId) {
  const res = await request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8" } },
  );
  expect(res.ok(), "create session").toBeTruthy();
  return (await res.json()).session.sessionId;
}

/**
 * The dock attaches the user's newest live terminal before creating one, so a leftover
 * shell from a previous test would leak into the next test's screen. Each test starts from
 * zero terminals; kill is async (SIGHUP → pty exit), so poll until none is alive.
 */
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

const dock = (page) => page.locator('[data-testid="terminal-dock"]');
const dockScreenText = (page) => dock(page).locator(".xterm-rows").innerText();

async function runInDock(page, command) {
  await dock(page).locator(".xterm-screen").click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

/** Waits until the dock's shell is really at a prompt (see terminal.spec.mjs). */
async function waitForDockShell(page, tag) {
  await expect(
    page.locator('[data-testid="terminal-dock-status"][data-status="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  await runInDock(page, `echo ${tag}`);
  await expect
    .poll(() => dockScreenText(page), { timeout: 30000 })
    .toMatch(new RegExp(`^${tag}$`, "m"));
}

test("Ctrl+` toggles the dock; the shell survives close and reopen", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/chat`);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20000 });

  // Open with the keyboard, like Codex/VS Code.
  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await waitForDockShell(page, "DOCK_UP_1");

  await runInDock(page, "echo DOCK_KEEPS_RUNNING");
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("DOCK_KEEPS_RUNNING");

  // Close via the header X: the view goes away, the shell does not.
  await page.locator('[data-testid="terminal-dock-close"]').click();
  await expect(dock(page)).toBeHidden();

  // Reopen with the shortcut: same shell, same screen.
  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await expect(
    page.locator('[data-testid="terminal-dock-status"][data-status="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("DOCK_KEEPS_RUNNING");
});

test("Detach hands the terminal to /terminal?id=… and the dock lets go", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/chat`);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20000 });

  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await waitForDockShell(page, "DOCK_UP_2");
  await runInDock(page, "echo DETACH_MARKER");
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("DETACH_MARKER");

  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.locator('[data-testid="terminal-dock-detach"]').click(),
  ]);

  // The dock closed; the popup is the standalone page attached to the same terminal.
  await expect(dock(page)).toBeHidden();
  expect(popup.url()).toMatch(/\/terminal\?id=/);
  await expect(
    popup.locator('[data-testid="terminal-status"][data-status="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  await expect
    .poll(() => popup.locator(".xterm-rows").innerText(), { timeout: 15000 })
    .toContain("DETACH_MARKER");

  // The detached window is live, not a snapshot.
  await popup.click(".xterm-screen");
  await popup.keyboard.type("echo DETACHED_LIVE");
  await popup.keyboard.press("Enter");
  await expect
    .poll(() => popup.locator(".xterm-rows").innerText(), { timeout: 15000 })
    .toContain("DETACHED_LIVE");

  // Reopening the dock reattaches the last-opened terminal — the same shell the window
  // now holds (the stream supports multiple attached clients), per the persistence rules.
  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await expect(
    page.locator('[data-testid="terminal-dock-status"][data-status="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("DETACH_MARKER");
});

test("panel switcher: default pins, all-panels dropdown, pin/unpin persists", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  const sessionId = await createSession(page.request, projectId);
  await page.goto(`${BASE}/chat/${sessionId}`);

  // Default pins: agents + workspace icons in the toolbar, no terminal icon.
  const toolbar = page.locator('[data-testid="panels-toolbar"]');
  await expect(toolbar).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="panel-btn-agents"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-btn-workspace"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-btn-terminal"]')).toHaveCount(0);
  // Icon-only triggers: the accessible name lives in aria-label, not visible text.
  expect((await page.locator('[data-testid="panel-btn-agents"]').innerText()).trim()).toBe("");

  // The "all panels" dropdown lists every panel with its name.
  await page.locator('[data-testid="panels-all"]').click();
  await expect(page.locator('[data-testid="panels-menu-agents"]')).toContainText("智能体面板");
  await expect(page.locator('[data-testid="panels-menu-terminal"]')).toContainText("终端");
  await expect(page.locator('[data-testid="panels-menu-workspace"]')).toContainText("工作区");

  // A row click opens that panel (and dismisses the menu): the terminal dock appears.
  await page.locator('[data-testid="panels-menu-terminal"]').click();
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="panels-menu-terminal"]')).toBeHidden();

  // Pin the terminal, unpin the workspace — the menu stays open across pin toggles.
  await page.locator('[data-testid="panels-all"]').click();
  await page.locator('[data-testid="panels-pin-terminal"]').click();
  await expect(page.locator('[data-testid="panel-btn-terminal"]')).toBeVisible();
  await page.locator('[data-testid="panels-pin-workspace"]').click();
  await expect(page.locator('[data-testid="panel-btn-workspace"]')).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The pinned terminal icon toggles the dock like any other panel trigger.
  await page.locator('[data-testid="panel-btn-terminal"]').click();
  await expect(dock(page)).toBeHidden();
  await page.locator('[data-testid="panel-btn-terminal"]').click();
  await expect(dock(page)).toBeVisible({ timeout: 10000 });

  // Pins persist across a reload.
  await page.reload();
  await expect(page.locator('[data-testid="panels-toolbar"]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="panel-btn-terminal"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-btn-workspace"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="panel-btn-agents"]')).toBeVisible();
});

test("dock tabs: list every shell, switch between them, kill one", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/chat`);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20000 });

  const tabs = page.locator('[data-testid="terminal-tab"]');

  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await waitForDockShell(page, "TAB_SHELL_A");
  await runInDock(page, "echo IN_TAB_A");
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("IN_TAB_A");
  await expect(tabs).toHaveCount(1, { timeout: 15000 });

  // "+" opens a second shell in a new tab; both are listed, the new one is active.
  await page.locator('[data-testid="terminal-dock-new-shell"]').click();
  await waitForDockShell(page, "TAB_SHELL_B");
  await runInDock(page, "echo IN_TAB_B");
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("IN_TAB_B");
  await expect(tabs).toHaveCount(2, { timeout: 15000 });
  await expect(tabs.last()).toHaveAttribute("data-active", "true");

  // Clicking the first tab switches back to shell A's screen (list order = creation order)…
  await tabs.first().locator("button").first().click();
  await expect(
    page.locator('[data-testid="terminal-dock-status"][data-status="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("IN_TAB_A");
  await expect(tabs.first()).toHaveAttribute("data-active", "true");

  // …and the second tab brings shell B back.
  await tabs.last().locator("button").first().click();
  await expect(
    page.locator('[data-testid="terminal-dock-status"][data-status="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("IN_TAB_B");

  // Killing the background tab (A) ends that shell; the current one is untouched. The
  // strip reacts to the user's own kill optimistically — no server round-trip to wait for.
  await tabs.first().hover();
  await tabs.first().locator('[data-testid="terminal-tab-kill"]').click();
  await expect(tabs).toHaveCount(1, { timeout: 2000 });
  expect(await dockScreenText(page)).toContain("IN_TAB_B");

  // Killing the last tab means "done with terminals": the dock closes rather than
  // spawning a replacement nobody asked for.
  await tabs.first().hover();
  await tabs.first().locator('[data-testid="terminal-tab-kill"]').click();
  await expect(dock(page)).toBeHidden({ timeout: 15000 });

  // Reopening starts fresh — nothing left to reattach.
  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await waitForDockShell(page, "TAB_SHELL_C");
  expect(await dockScreenText(page)).not.toContain("IN_TAB_B");
  await expect(tabs).toHaveCount(1, { timeout: 15000 });
});

test("tab interactions: reorder by drag, live title, detach keeps the dock", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/chat`);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20000 });

  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await waitForDockShell(page, "TAB_I_A");
  await runInDock(page, "echo FIRST_TAB_MARK");
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("FIRST_TAB_MARK");

  await page.locator('[data-testid="terminal-dock-new-shell"]').click();
  await waitForDockShell(page, "TAB_I_B");
  const tabs = page.locator('[data-testid="terminal-tab"]');
  await expect(tabs).toHaveCount(2, { timeout: 5000 });

  // The "+" lives outside the scrollable strip, so it stays reachable however many tabs.
  await expect(page.locator('[data-testid="terminal-dock-new-shell"]')).toBeVisible();

  // Live title: the shell's OSC title lands on the active tab's label (sleep keeps the
  // title up until the assertion has run — the next prompt may reset it).
  await runInDock(page, "printf '\\033]0;LIVE_TITLE_X\\007'; sleep 3");
  await expect(tabs.last()).toContainText("LIVE_TITLE_X", { timeout: 5000 });
  const titledId = await tabs.last().getAttribute("data-terminal-id");

  // Reorder: drag the titled tab (B, currently last) in front of A.
  const ab = await tabs.first().boundingBox();
  const bb = await tabs.last().boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(ab.x + 4, ab.y + ab.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(tabs.first()).toHaveAttribute("data-terminal-id", titledId);

  // The order persists across a reload.
  await page.reload();
  await expect(dock(page)).toBeVisible({ timeout: 20000 });
  await expect(tabs).toHaveCount(2, { timeout: 15000 });
  await expect(tabs.first()).toHaveAttribute("data-terminal-id", titledId);
  await expect(
    page.locator('[data-testid="terminal-dock-status"][data-status="ready"]'),
  ).toBeVisible({ timeout: 20000 });

  // Detach with another terminal open: the current shell goes to its own window and the
  // dock STAYS, switched onto the remaining tab (its screen restores).
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.locator('[data-testid="terminal-dock-detach"]').click(),
  ]);
  expect(popup.url()).toMatch(/\/terminal\?id=/);
  await expect(dock(page)).toBeVisible();
  await expect(
    page.locator('[data-testid="terminal-dock-status"][data-status="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="terminal-tab"][data-active="true"]')).not.toHaveAttribute(
    "data-terminal-id",
    titledId,
  );
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("FIRST_TAB_MARK");
});

test("tabs are numbered and drag-out detaches into a new window", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/chat`);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20000 });

  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await waitForDockShell(page, "NUM_A");
  await page.locator('[data-testid="terminal-dock-new-shell"]').click();
  await waitForDockShell(page, "NUM_B");

  // Index prefixes keep identical names/titles apart (and the server numbers default
  // names too: both shells were created in the same directory).
  const tabs = page.locator('[data-testid="terminal-tab"]');
  await expect(tabs).toHaveCount(2, { timeout: 5000 });
  await expect(tabs.first()).toContainText("1: ");
  await expect(tabs.last()).toContainText("2: ");
  const firstLabel = await tabs.first().innerText();
  const lastLabel = await tabs.last().innerText();
  expect(firstLabel).not.toBe(lastLabel);

  // Drag the background tab (A) downward out of the strip: a hint appears; releasing
  // opens that terminal in its own window while the dock stays as it was.
  const draggedId = await tabs.first().getAttribute("data-terminal-id");
  const fb = await tabs.first().boundingBox();
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await page.mouse.down();
  await page.mouse.move(fb.x + fb.width / 2 + 10, fb.y + 120, { steps: 5 });
  await expect(page.locator('[data-testid="tab-detach-hint"]')).toBeVisible();
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.mouse.up()]);
  expect(popup.url()).toContain(`/terminal?id=${draggedId}`);
  await expect(page.locator('[data-testid="tab-detach-hint"]')).toHaveCount(0);

  // A background tab was detached: the dock keeps its current shell and both terminals
  // stay listed (the detached one is still live).
  await expect(dock(page)).toBeVisible();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.last()).toHaveAttribute("data-active", "true");
  // …and the popup really is terminal A, live.
  await expect(
    popup.locator('[data-testid="terminal-status"][data-status="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  await expect
    .poll(() => popup.locator(".xterm-rows").innerText(), { timeout: 15000 })
    .toContain("NUM_A");
});

test("dock layout: drag to an edge or onto the drop targets, preview then apply", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/chat`);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20000 });

  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await waitForDockShell(page, "LAYOUT_SHELL");
  await expect(dock(page)).toHaveAttribute("data-position", "bottom"); // the default

  const header = page.locator('[data-testid="terminal-dock-header"]');
  const ready = page.locator('[data-testid="terminal-dock-status"][data-status="ready"]');

  // Repositioning must not remount the terminal (a remount would drop the WebSocket and
  // repaint the screen): remember the live xterm DOM node to compare after the moves.
  await page.evaluate(() => {
    window.__xtermBeforeMove = document.querySelector('[data-testid="terminal-dock"] .xterm');
  });

  // Method 2: drag the header onto the "left" rectangle of the left/right container.
  let hb = await header.boundingBox();
  await page.mouse.move(hb.x + 24, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 90, hb.y - 60, { steps: 4 }); // past the threshold → overlay
  const leftTarget = page.locator('[data-dock-pos="left"]');
  await expect(leftTarget).toBeVisible();
  const lt = await leftTarget.boundingBox();
  await page.mouse.move(lt.x + lt.width / 2, lt.y + lt.height / 2, { steps: 4 });
  await expect(page.locator('[data-testid="dock-layout-preview"]')).toHaveAttribute(
    "data-pos",
    "left",
  );
  const previewBox = await page.locator('[data-testid="dock-layout-preview"]').boundingBox();
  await page.mouse.up();
  await expect(dock(page)).toHaveAttribute("data-position", "left");

  // The preview promised the real final region: the landed dock occupies (within a couple
  // of px of border rounding) exactly the rectangle that was previewed.
  const landedBox = await dock(page).boundingBox();
  for (const side of ["x", "y", "width", "height"]) {
    expect(Math.abs(landedBox[side] - previewBox[side]), `preview vs landed ${side}`).toBeLessThan(
      3,
    );
  }

  // The move kept the very same terminal instance — same xterm DOM node, same connection,
  // screen intact without any restore repaint — and it stays interactive.
  await expect(ready).toBeVisible({ timeout: 20000 });
  expect(
    await page.evaluate(
      () =>
        document.querySelector('[data-testid="terminal-dock"] .xterm') === window.__xtermBeforeMove,
    ),
    "xterm survived the reposition",
  ).toBe(true);
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("LAYOUT_SHELL");
  await runInDock(page, "echo AFTER_MOVE_LEFT");
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("AFTER_MOVE_LEFT");

  // Method 1: drag straight into the top edge band of the content area.
  hb = await header.boundingBox();
  const host = await page.locator("[data-dock-host]").boundingBox();
  await page.mouse.move(hb.x + 24, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(host.x + host.width / 2, host.y + 30, { steps: 6 });
  await expect(page.locator('[data-testid="dock-layout-preview"]')).toHaveAttribute(
    "data-pos",
    "top",
  );
  await page.mouse.up();
  await expect(dock(page)).toHaveAttribute("data-position", "top");
  await expect(ready).toBeVisible({ timeout: 20000 });

  // Releasing in the neutral middle changes nothing.
  hb = await header.boundingBox();
  await page.mouse.move(hb.x + 24, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2, { steps: 4 });
  await expect(page.locator('[data-testid="dock-layout-preview"]')).toHaveCount(0);
  await page.mouse.up();
  await expect(dock(page)).toHaveAttribute("data-position", "top");

  // The position survives a reload.
  await page.reload();
  await expect(dock(page)).toBeVisible({ timeout: 20000 });
  await expect(dock(page)).toHaveAttribute("data-position", "top");
});

test("dock resize: drag the boundary; the ratio survives reposition and reload", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/chat`);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20000 });

  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await waitForDockShell(page, "RESIZE_SHELL");

  // Grow the bottom dock ~120px by dragging the boundary upward.
  const before = await dock(page).boundingBox();
  const rz = await page.locator('[data-testid="terminal-dock-resizer"]').boundingBox();
  await page.mouse.move(rz.x + rz.width / 2, rz.y + rz.height / 2);
  await page.mouse.down();
  await page.mouse.move(rz.x + rz.width / 2, rz.y + rz.height / 2 - 120, { steps: 6 });
  await page.mouse.up();
  const grown = await dock(page).boundingBox();
  expect(grown.height - before.height).toBeGreaterThan(100);

  // Live resize, no reconnect: the shell answers immediately at the new size.
  await runInDock(page, "echo RESIZED_OK");
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("RESIZED_OK");

  // Repositioning to the top keeps the height ratio (same orientation, same row height).
  const hb = await page.locator('[data-testid="terminal-dock-header"]').boundingBox();
  const host = await page.locator("[data-dock-host]").boundingBox();
  await page.mouse.move(hb.x + 24, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(host.x + host.width / 2, host.y + 30, { steps: 6 });
  await page.mouse.up();
  await expect(dock(page)).toHaveAttribute("data-position", "top");
  const atTop = await dock(page).boundingBox();
  expect(Math.abs(atTop.height - grown.height), "ratio kept across reposition").toBeLessThan(8);

  // The size survives a reload…
  await page.reload();
  await expect(dock(page)).toBeVisible({ timeout: 20000 });
  const reloaded = await dock(page).boundingBox();
  expect(Math.abs(reloaded.height - grown.height), "ratio kept across reload").toBeLessThan(8);

  // …and double-clicking the boundary resets to the default 40% of the row.
  const rz2 = await page.locator('[data-testid="terminal-dock-resizer"]').boundingBox();
  await page.mouse.dblclick(rz2.x + rz2.width / 2, rz2.y + rz2.height / 2);
  const resetBox = await dock(page).boundingBox();
  const row = await page.locator("[data-dock-row]").boundingBox();
  expect(Math.abs(resetBox.height - row.height * 0.4), "double-click reset").toBeLessThan(10);
});

test("terminal clipboard: keyboard copy/paste, right-click, focus", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/chat`);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20000 });

  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await waitForDockShell(page, "CLIP_SHELL");

  // Copy: double-click selects the word, Ctrl+Shift+C puts it on the clipboard.
  await runInDock(page, "echo COPY_ME_TOKEN");
  await expect
    .poll(() => dockScreenText(page), { timeout: 15000 })
    .toMatch(/^COPY_ME_TOKEN$/m);
  await dock(page).locator(".xterm-rows").getByText("COPY_ME_TOKEN").last().dblclick();
  await page.keyboard.press("Control+Shift+C");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10000 })
    .toContain("COPY_ME_TOKEN");

  // Paste via Ctrl+Shift+V (rides the browser's native paste event — exactly once).
  await page.evaluate(() => navigator.clipboard.writeText("echo PASTE_VIA_KEYS"));
  await dock(page).locator(".xterm-screen").click();
  await page.keyboard.press("Control+Shift+V");
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("echo PASTE_VIA_KEYS");
  await page.keyboard.press("Enter");
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toMatch(/^PASTE_VIA_KEYS$/m);
  // …exactly once: the command line appears a single time before its output.
  expect((await dockScreenText(page)).match(/echo PASTE_VIA_KEYS/g)).toHaveLength(1);

  // Right-click with no selection pastes (and the page context menu is suppressed —
  // if it opened, the keystrokes below would land in the menu, not the shell). The
  // async-clipboard read means the text lands a beat later; wait before executing.
  await page.evaluate(() => navigator.clipboard.writeText("echo PASTE_VIA_MOUSE"));
  await dock(page).locator(".xterm-screen").click({ button: "right" });
  await expect
    .poll(() => dockScreenText(page), { timeout: 15000 })
    .toContain("echo PASTE_VIA_MOUSE");
  await page.keyboard.press("Enter");
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toMatch(/^PASTE_VIA_MOUSE$/m);

  // Focus mechanism: clicking the view's padding (outside the xterm screen itself) still
  // routes subsequent typing into the shell.
  const view = dock(page).locator(".xterm").locator("..");
  const vb = await view.boundingBox();
  await page.mouse.click(vb.x + vb.width - 4, vb.y + vb.height - 4); // bottom-right padding
  await page.keyboard.type("echo FOCUS_BY_CLICK");
  await page.keyboard.press("Enter");
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toMatch(/^FOCUS_BY_CLICK$/m);
});

test("terminal count badge and last-opened persistence", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  const sessionId = await createSession(page.request, projectId);

  // Seed one live terminal entirely through the API, with a marker on its screen.
  const created = await page.request.post(`${BASE}/api/terminals`, {
    data: { cwd: "/tmp", cols: 100, rows: 30 },
  });
  expect(created.status()).toBe(201);
  const { id: seededId } = await created.json();
  await page.request.post(`${BASE}/api/terminals/${seededId}/keys`, {
    data: { keys: "echo LAST_OPENED_MARKER", literal: true },
  });
  await page.request.post(`${BASE}/api/terminals/${seededId}/keys`, { data: { keys: "Enter" } });
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${BASE}/api/terminals/${seededId}/capture`);
        return (await res.json()).lines.join("\n");
      },
      { timeout: 20000 },
    )
    .toMatch(/^LAST_OPENED_MARKER$/m);

  await page.goto(`${BASE}/chat/${sessionId}`);
  await expect(page.locator('[data-testid="panels-toolbar"]')).toBeVisible({ timeout: 20000 });

  // One live terminal → badge "1"; the terminal is not pinned by default, so the badge
  // floats on the "all panels" trigger.
  const badge = page.locator('[data-testid="terminal-count-badge"]');
  await expect(badge).toHaveText("1", { timeout: 15000 });
  await expect(
    page.locator('[data-testid="panels-all"] [data-testid="terminal-count-badge"]'),
  ).toBeVisible();

  // The dropdown's terminal row carries the same live count.
  await page.locator('[data-testid="panels-all"]').click();
  await expect(page.locator('[data-testid="panels-menu-terminal-count"]')).toHaveText("1");
  await page.keyboard.press("Escape");

  // Opening the terminal attaches the existing (last-opened) shell instead of creating a
  // second one: its marker is on the dock screen and the count stays 1.
  await page.locator('[data-testid="panels-all"]').click();
  await page.locator('[data-testid="panels-menu-terminal"]').click();
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await expect(
    page.locator('[data-testid="terminal-dock-status"][data-status="ready"]'),
  ).toBeVisible({ timeout: 20000 });
  await expect.poll(() => dockScreenText(page), { timeout: 15000 }).toContain("LAST_OPENED_MARKER");
  await expect(badge).toHaveText("1");

  // Pinning the terminal moves the badge onto the terminal's own trigger.
  await page.locator('[data-testid="panels-all"]').click();
  await page.locator('[data-testid="panels-pin-terminal"]').click();
  await page.keyboard.press("Escape");
  await expect(
    page.locator('[data-testid="panel-btn-terminal"] [data-testid="terminal-count-badge"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="panels-all"] [data-testid="terminal-count-badge"]'),
  ).toHaveCount(0);

  // "New shell" leaves the old shell running: two live terminals now, counted as soon as
  // the create returns (optimistic list update, not the next poll).
  await page.locator('[data-testid="terminal-dock-new-shell"]').click();
  await expect(badge).toHaveText("2", { timeout: 5000 });
  await waitForDockShell(page, "SECOND_SHELL_UP");

  // Killing every terminal clears the badge entirely (0 renders nothing). A background
  // terminal dying does not push anything to the tab — the count re-syncs on focus (or the
  // slow poll), so nudge a focus event while polling instead of waiting out the interval.
  await killAllTerminals(page.request);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        return badge.count();
      },
      { timeout: 15000 },
    )
    .toBe(0);
});
