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

  // "New shell" leaves the old shell running: two live terminals now.
  await page.locator('[data-testid="terminal-dock-new-shell"]').click();
  await waitForDockShell(page, "SECOND_SHELL_UP");
  await expect(badge).toHaveText("2", { timeout: 15000 });

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
