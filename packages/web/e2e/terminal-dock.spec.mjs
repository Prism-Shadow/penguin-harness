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

  // Reopening the dock starts a fresh shell — the old one now belongs to the window.
  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible({ timeout: 10000 });
  await waitForDockShell(page, "DOCK_UP_3");
  expect(await dockScreenText(page)).not.toContain("DETACH_MARKER");
});

test("panel switcher: default pins, all-panels dropdown, pin/unpin persists", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = await configureProjectModel(page.request);
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
