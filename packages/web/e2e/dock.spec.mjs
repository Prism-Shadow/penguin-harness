/**
 * The dock system (features/dock) and the chat toolbar's panel switcher: every side
 * element — subagents panel, Workspace files, Memory, Trace, terminals — is a tab in the
 * right or bottom dock.
 * - Ctrl+` toggles the terminal tabs (front → hide → restore); the shell keeps running
 *   while hidden and reattaches on reopen;
 * - tabs of different kinds mix in one strip; a panel tab's × closes the panel, a
 *   terminal tab's × kills the shell;
 * - the toolbar's create menu carries per-element placement actions (right / bottom) and
 *   pin toggles that persist; agents + workspace are pinned by default;
 * - a whole dock moves to the other edge via its header button, a single tab via drag
 *   onto the drop targets;
 * - the bottom dock's height ratio and the whole arrangement (tabs, active, hidden docks)
 *   survive a reload, and the arrangement is GLOBAL — switching conversations keeps it;
 * - "Detach" hands the terminal off to /terminal?id=… in a new window and its tab leaves;
 * - a failed shell create surfaces as an error toast instead of silence.
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

async function createSession(request, projectId) {
  const res = await request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8" } },
  );
  expect(res.ok(), "create session").toBeTruthy();
  return (await res.json()).session.sessionId;
}

/**
 * The dock adopts the user's newest tab-less live terminal before creating one, so a
 * leftover shell from a previous test would leak into the next test's screen. Each test
 * starts from zero terminals; kill is async (SIGHUP → pty exit), so poll until none is
 * alive. The persisted arrangement is per-browser-context (fresh per test), so only the
 * server-side shells need cleaning.
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

const dockAt = (page, position) =>
  page.locator(`[data-testid="dock"][data-position="${position}"]`);
const anyDock = (page) => page.locator('[data-testid="dock"]');
const terminalBody = (page) => page.locator('[data-testid="dock-terminal-body"]:visible');
const screenText = (page) => terminalBody(page).locator(".xterm-rows").innerText();

async function runInTerminal(page, command) {
  await terminalBody(page).locator(".xterm-screen").click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

/**
 * Waits until the shown terminal is really at a prompt (see terminal.spec.mjs). The
 * sentinel is typed quote-split (echo TA''G) so the command's own echo never contains the
 * tag, and matched at end-of-line: a resize reflow right after attach can glue the echoed
 * command and its output onto one DOM row, where a ^tag$ match would never fire.
 */
async function waitForShell(page, tag) {
  await expect(page.locator('[data-testid="dock-terminal-body"][data-status="ready"]')).toBeVisible(
    { timeout: 20000 },
  );
  await runInTerminal(page, `echo ${tag.slice(0, 2)}''${tag.slice(2)}`);
  await expect.poll(() => screenText(page), { timeout: 30000 }).toMatch(new RegExp(`${tag}$`, "m"));
}

test("Ctrl+` opens a shell in the bottom dock; hiding keeps it running, reopening reattaches", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  await page.goto(`${BASE}/chat`);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20000 });

  // Open with the keyboard, like Codex/VS Code. The docks render on the draft page too.
  await page.keyboard.press("Control+Backquote");
  await expect(dockAt(page, "bottom")).toBeVisible({ timeout: 10000 });
  await waitForShell(page, "DOCK_UP_1");
  await runInTerminal(page, "echo DOCK_KEEPS_RUNNING");
  await expect.poll(() => screenText(page), { timeout: 15000 }).toContain("DOCK_KEEPS_RUNNING");

  // Hide via the dock's ×: the surface goes away, the tab and the shell do not.
  await dockAt(page, "bottom").getByTestId("dock-close").click();
  await expect(anyDock(page)).toHaveCount(0);
  await expect
    .poll(async () => {
      const res = await (await page.request.get(`${BASE}/api/terminals`)).json();
      return res.terminals.filter((t) => t.alive).length;
    })
    .toBe(1);

  // Ctrl+` restores the same shell — the marker typed before the hide is still on screen.
  await page.keyboard.press("Control+Backquote");
  await expect(dockAt(page, "bottom")).toBeVisible();
  await expect.poll(() => screenText(page), { timeout: 20000 }).toContain("DOCK_KEEPS_RUNNING");

  // A terminal tab's × kills the shell itself; the last tab gone hides the dock.
  const tab = dockAt(page, "bottom").locator('[data-testid="dock-tab"][data-terminal-id]');
  await tab.hover();
  await tab.getByTestId("dock-tab-close").click();
  await expect(anyDock(page)).toHaveCount(0);
  await expect
    .poll(
      async () => {
        const res = await (await page.request.get(`${BASE}/api/terminals`)).json();
        return res.terminals.filter((t) => t.alive).length;
      },
      { timeout: 10000 },
    )
    .toBe(0);
});

test("tabs of every kind share a dock: switch, close a panel tab, terminals numbered", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  const sessionId = await createSession(page.request, projectId);
  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).waitFor();

  // Workspace via its pinned toolbar trigger → a right-dock tab.
  await page.getByRole("button", { name: "打开工作区" }).click();
  const right = dockAt(page, "right");
  await expect(right.locator('[data-tab-id="workspace"][data-active="true"]')).toBeVisible();

  // A shell into the SAME dock through its own "+" menu.
  await right.getByTestId("dock-add").click();
  await page.getByTestId("dock-add-terminal").click();
  await expect(
    right.locator('[data-testid="dock-tab"][data-terminal-id][data-active="true"]'),
  ).toBeVisible({ timeout: 20000 });
  await waitForShell(page, "MIXED_DOCK");
  // The strip lists both kinds; the terminal label carries its stable `N:` seq prefix.
  await expect(right.locator('[data-testid="dock-tab"]')).toHaveCount(2);
  await expect(right.locator('[data-testid="dock-tab"][data-terminal-id]').first()).toContainText(
    /^\d+:/,
  );

  // Tab click switches; the terminal's view survives being covered (still attached below).
  await right.locator('[data-tab-id="workspace"]').click();
  await expect(right.locator('[data-tab-id="workspace"][data-active="true"]')).toBeVisible();
  await expect(right.getByText("根目录")).toBeVisible();
  await right.locator('[data-testid="dock-tab"][data-terminal-id]').click();
  await expect.poll(() => screenText(page), { timeout: 20000 }).toContain("MIXED_DOCK");

  // A panel tab's × closes just the panel; the terminal tab remains, dock stays.
  const wsTab = right.locator('[data-tab-id="workspace"]');
  await wsTab.hover();
  await wsTab.getByTestId("dock-tab-close").click();
  await expect(right.locator('[data-testid="dock-tab"]')).toHaveCount(1);
  await expect(right).toBeVisible();
  await killAllTerminals(page.request);
});

test("panel switcher: default pins, placement actions, pin/unpin persists", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  const sessionId = await createSession(page.request, projectId);
  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).waitFor();

  // Defaults: agents + workspace pinned; terminal / memory / trace only in the menu.
  await expect(page.getByTestId("panel-btn-agents")).toBeVisible();
  await expect(page.getByTestId("panel-btn-workspace")).toBeVisible();
  await expect(page.getByTestId("panel-btn-terminal")).toHaveCount(0);
  await expect(page.getByTestId("panel-btn-memory")).toHaveCount(0);
  await expect(page.getByTestId("panel-btn-trace")).toHaveCount(0);

  // The create menu lists all five entries.
  await page.getByTestId("panels-all").click();
  for (const key of ["agents", "terminal", "workspace", "memory", "trace"]) {
    await expect(page.getByTestId(`panels-menu-${key}`)).toBeVisible();
  }

  // Placement: trace to the RIGHT dock; memory to the BOTTOM dock — both from the menu.
  await page.getByTestId("panels-place-right-trace").click();
  await expect(
    dockAt(page, "right").locator('[data-tab-id="trace"][data-active="true"]'),
  ).toBeVisible();
  await page.getByTestId("panels-place-bottom-memory").click();
  await expect(
    dockAt(page, "bottom").locator('[data-tab-id="memory"][data-active="true"]'),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Both docks visible at once — the exclusivity of the old drawer panels is gone.
  await expect(anyDock(page)).toHaveCount(2);

  // Toggling a SHOWN panel closes its tab (memory is unpinned: toggle through the menu).
  await page.getByTestId("panels-all").click();
  await page.getByTestId("panels-menu-memory").click();
  await expect(dockAt(page, "bottom")).toHaveCount(0); // its only tab closed → dock gone

  // Pinning the terminal persists across reloads.
  await page.getByTestId("panels-all").click();
  await page.getByTestId("panels-pin-terminal").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("panel-btn-terminal")).toBeVisible();
  await page.reload();
  await page.getByPlaceholder(/输入消息/).waitFor();
  await expect(page.getByTestId("panel-btn-terminal")).toBeVisible();
});

test("a whole dock moves to the other edge; a single tab moves by drag onto the drop target", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  const sessionId = await createSession(page.request, projectId);
  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).waitFor();

  await page.getByRole("button", { name: "打开工作区" }).click();
  await page.getByTestId("panels-all").click();
  await page.getByTestId("panels-place-right-trace").click();
  await page.keyboard.press("Escape");
  const right = dockAt(page, "right");
  await expect(right.locator('[data-testid="dock-tab"]')).toHaveCount(2);

  // Header button: the whole dock (both tabs) onto the bottom edge.
  await right.getByTestId("dock-move").click();
  await expect(dockAt(page, "right")).toHaveCount(0);
  const bottom = dockAt(page, "bottom");
  await expect(bottom.locator('[data-testid="dock-tab"]')).toHaveCount(2);
  // The shown tab (trace, active before the move) stays the shown tab after it.
  await expect(bottom.locator('[data-tab-id="trace"][data-active="true"]')).toBeVisible();

  // Drag the workspace tab out of the strip: the edge overlay appears; dropping on the
  // RIGHT target splits it back out into its own right dock.
  const wsTab = bottom.locator('[data-tab-id="workspace"]');
  const wb = await wsTab.boundingBox();
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2);
  await page.mouse.down();
  await page.mouse.move(wb.x + wb.width / 2 + 10, wb.y - 120, { steps: 5 });
  await expect(page.getByTestId("dock-layout-widget")).toBeVisible();
  const target = page.locator('[data-testid="dock-layout-target"][data-dock-pos="right"]');
  const tb = await target.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 4 });
  await expect(page.locator('[data-testid="dock-layout-preview"][data-pos="right"]')).toBeVisible();
  await page.mouse.up();
  await expect(
    dockAt(page, "right").locator('[data-tab-id="workspace"][data-active="true"]'),
  ).toBeVisible();
  await expect(bottom.locator('[data-tab-id="trace"]')).toBeVisible();
});

test("sizes and the whole arrangement survive a reload; hidden stays hidden", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  const sessionId = await createSession(page.request, projectId);
  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).waitFor();

  await page.getByTestId("panels-all").click();
  await page.getByTestId("panels-place-bottom-trace").click();
  await page.getByTestId("panels-place-right-workspace").click();
  await page.keyboard.press("Escape");
  const bottom = dockAt(page, "bottom");
  await expect(bottom).toBeVisible();

  // Drag the bottom boundary up ~120px: the height ratio grows and persists.
  const before = (await bottom.boundingBox()).height;
  const resizer = bottom.getByTestId("dock-resizer");
  const rb = await resizer.boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + rb.width / 2, rb.y - 120, { steps: 6 });
  await page.mouse.up();
  const after = (await bottom.boundingBox()).height;
  expect(after - before).toBeGreaterThan(80);

  // Hide the right dock (its tab stays behind), then reload: the bottom dock comes back
  // at its size, the right dock stays hidden, and reopening restores its tab.
  await dockAt(page, "right").getByTestId("dock-close").click();
  await expect(dockAt(page, "right")).toHaveCount(0);
  await page.reload();
  await page.getByPlaceholder(/输入消息/).waitFor();
  await expect(
    dockAt(page, "bottom").locator('[data-tab-id="trace"][data-active="true"]'),
  ).toBeVisible();
  await expect(dockAt(page, "right")).toHaveCount(0);
  const reloaded = (await dockAt(page, "bottom").boundingBox()).height;
  expect(Math.abs(reloaded - after)).toBeLessThan(24);
  await page.getByRole("button", { name: "打开工作区" }).click();
  await expect(
    dockAt(page, "right").locator('[data-tab-id="workspace"][data-active="true"]'),
  ).toBeVisible();
});

test("the arrangement is global: switching conversations keeps the docks and the shell", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  const sidA = await createSession(page.request, projectId);
  const sidB = await createSession(page.request, projectId);

  await page.goto(`${BASE}/chat/${sidA}`);
  await page.getByPlaceholder(/输入消息/).waitFor();
  await page.getByRole("button", { name: "打开工作区" }).click();
  await page.keyboard.press("Control+Backquote");
  await expect(dockAt(page, "bottom")).toBeVisible({ timeout: 20000 });
  await waitForShell(page, "GLOBAL_SHELL");

  // Switch to the other conversation: both docks stay, the same shell stays in the
  // strip, and the Workspace re-binds to B. The identity check rides on the tab's id and
  // a FRESH probe typed after the switch — not on the scrollback replay, whose stream has
  // a known load-sensitive flake that predates the dock rework.
  const preId = await page
    .locator('[data-testid="dock-tab"][data-terminal-id]')
    .getAttribute("data-terminal-id");
  await page.goto(`${BASE}/chat/${sidB}`);
  await page.getByPlaceholder(/输入消息/).waitFor();
  await expect(dockAt(page, "right").locator('[data-tab-id="workspace"]')).toBeVisible();
  await expect(
    page.locator(`[data-testid="dock-tab"][data-terminal-id="${preId}"][data-active="true"]`),
  ).toBeVisible();
  await waitForShell(page, "STILL_SAME_SHELL");
  await killAllTerminals(page.request);
});

test("Detach hands the terminal to /terminal?id=… and its tab leaves the strip", async ({
  page,
  context,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  const sessionId = await createSession(page.request, projectId);
  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).waitFor();

  await page.keyboard.press("Control+Backquote");
  await expect(dockAt(page, "bottom")).toBeVisible({ timeout: 20000 });
  await waitForShell(page, "DETACH_ME");

  const popupPromise = context.waitForEvent("page");
  await dockAt(page, "bottom").getByTestId("dock-detach").click();
  const popup = await popupPromise;
  await popup.waitForURL(/\/terminal\?id=/);
  // Same shell, same screen: the marker typed in the dock shows in the window.
  await expect
    .poll(() => popup.locator(".xterm-rows").innerText(), { timeout: 20000 })
    .toContain("DETACH_ME");
  // The dock let go: no terminal tab left (the dock hid with its last tab gone).
  await expect(anyDock(page)).toHaveCount(0);
  await popup.close();
  await killAllTerminals(page.request);
});

test("a failed shell create surfaces as a toast, and a later attempt recovers", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = await configureProjectModel(page.request);
  await killAllTerminals(page.request);
  const sessionId = await createSession(page.request, projectId);

  // Make terminal creation fail the way a broken pty does server-side (spawn failure).
  await page.route("**/api/terminals", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "terminal_spawn_failed",
          message: "Could not start a shell: posix_spawn failed (mock)",
        }),
      });
    }
    return route.continue();
  });

  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).waitFor();
  await page.keyboard.press("Control+Backquote");

  // The failure says WHY instead of doing nothing — the server's message included.
  await expect(page.getByText("posix_spawn failed (mock)")).toBeVisible({ timeout: 10000 });
  await expect(anyDock(page)).toHaveCount(0);

  // Server recovers (unroute) → the next attempt starts a real shell.
  await page.unroute("**/api/terminals");
  await page.keyboard.press("Control+Backquote");
  await expect(dockAt(page, "bottom")).toBeVisible({ timeout: 20000 });
  await waitForShell(page, "RECOVERED");
  await killAllTerminals(page.request);
});
