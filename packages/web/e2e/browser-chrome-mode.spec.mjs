/**
 * The Browser panel on a server with no desktop app, where the agents' only browser is the
 * user's own Chrome (features/builtin-browser/chrome-surface.tsx, pairing-dialog.tsx).
 * - A member's dock offers the Browser panel in a plain browser window, which hosts no
 *   `<webview>`. With no Chrome paired the panel shows the pairing steps inline: this page's
 *   address and a one-time code.
 * - The menu's Chrome row reads "尚未配对 Chrome" and opens the pairing dialog ("连接你的 Chrome"),
 *   which shows the same address and code and waits for Chrome.
 * - Pairing as the extension does — the code traded at POST /extension/pair with no cookie, then
 *   the extension's WebSocket with the token in its subprotocols, answering the server's hello —
 *   makes the dialog say "已连接" and close itself, and turns the panel into the Chrome surface.
 * - The strip's "+" asks the extension for a tab; the tab appears in the strip, and the page
 *   area stands a card for it with "在 Chrome 中显示". Its × asks the extension to close it.
 * The extension is played from the test process by a WebSocket client that speaks the browser
 * link's frames (desktop-browser-command / -reply / -event).
 */
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "chromeuser";
const P = "password123";

/** A Project without model credentials pops the onboarding overlay over the dock; configure one. */
async function configureProjectModel(req) {
  const projectId = (await (await req.get(`${BASE}/api/projects`)).json()).projects[0].projectId;
  const put = await req.put(`${BASE}/api/projects/${projectId}/models`, {
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

/** A conversation to open: the dock's toolbar toggles live on a conversation's page. */
async function createSession(req, projectId) {
  const res = await req.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
    data: { provider: "custom", modelId: "claude-4-8" },
  });
  expect(res.ok(), "create session").toBeTruthy();
  return (await res.json()).session.sessionId;
}

/**
 * The PenguinHarness Browser extension, as far as the server can tell: it holds the socket,
 * answers hello, tabs, ping, open-tab, close-tab and activate-tab, and pushes tab events.
 */
function fakeExtension(token) {
  const url = `${BASE.replace(/^http/, "ws")}/api/builtin-browser/extension/ws`;
  const ws = new WebSocket(url, ["penguin-browser.1", `token.${token}`]);
  const ops = [];
  const tabs = new Map();
  let nextTabId = 1501;
  const send = (frame) => ws.send(JSON.stringify(frame));
  const reply = (id, result) => send({ type: "desktop-browser-reply", id, ok: true, result });
  ws.addEventListener("message", (message) => {
    const frame = JSON.parse(String(message.data));
    if (frame.type !== "desktop-browser-command") return;
    const command = frame.command;
    ops.push(command.op);
    switch (command.op) {
      case "hello":
        reply(frame.id, {
          version: 1,
          backend: "chrome",
          extension: { version: "0.2.13", chrome: "130", name: "Chrome 130 on Linux" },
        });
        return;
      case "tabs":
        reply(frame.id, { tabs: [...tabs.values()] });
        return;
      case "open-tab": {
        const tab = {
          id: nextTabId++,
          url: command.url,
          title: "New Tab",
          loading: false,
          canGoBack: false,
          canGoForward: false,
        };
        tabs.set(tab.id, tab);
        reply(frame.id, { tab });
        send({ type: "desktop-browser-event", event: { kind: "tab", tab } });
        return;
      }
      case "close-tab":
        tabs.delete(command.tabId);
        reply(frame.id, {});
        send({
          type: "desktop-browser-event",
          event: { kind: "tab-closed", tabId: command.tabId },
        });
        return;
      default:
        reply(frame.id, {});
    }
  });
  return { ws, ops };
}

test("a member pairs their own Chrome from the Browser panel, and drives its tabs from there", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = await configureProjectModel(page.request);
  const sessionId = await createSession(page.request, projectId);
  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).waitFor();

  // Offered without a page host: this window has no <webview>.
  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-builtin-browser").click();
  const surface = page.getByTestId("browser-chrome-surface");
  await expect(surface).toHaveAttribute("data-standing", "unpaired");
  await expect(page.locator("webview")).toHaveCount(0);
  const origin = new URL(BASE).origin;
  await expect(surface.getByTestId("browser-pairing-server")).toHaveText(origin);
  await expect(surface.getByTestId("browser-pairing-code")).toHaveText(/^[A-Za-z0-9_-]{43}$/);

  // The menu's Chrome row opens the pairing dialog, which shows the same address and code.
  await surface.getByRole("button", { name: "更多" }).click();
  const row = page.getByTestId("browser-chrome-status");
  await expect(row).toContainText("尚未配对 Chrome");
  await row.click();
  const dialog = page.getByRole("dialog", { name: "连接你的 Chrome" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("browser-pairing-server")).toHaveText(origin);
  const code = (await dialog.getByTestId("browser-pairing-code").textContent()).trim();
  await expect(surface.getByTestId("browser-pairing-code")).toHaveText(code);
  await expect(dialog.getByText("正在等待 Chrome…")).toBeVisible();

  // The extension trades the code without a cookie, then connects with its token.
  const extensionSide = await playwrightRequest.newContext();
  const paired = await extensionSide.post(`${BASE}/api/builtin-browser/extension/pair`, {
    data: { code, name: "Chrome 130 on Linux", version: "0.2.13" },
  });
  expect(paired.ok(), await paired.text()).toBeTruthy();
  const { token } = await paired.json();
  await extensionSide.dispose();
  const chrome = fakeExtension(token);

  try {
    await expect(dialog.getByText("已连接")).toBeVisible({ timeout: 15000 });
    await expect(dialog).toHaveCount(0, { timeout: 5000 });
    await expect(surface).toHaveAttribute("data-standing", "connected");
    await expect(surface).toContainText("你的 Chrome 里还没有 Agent 的标签页");

    // "+" opens a tab in Chrome: the extension is asked, and the tab joins the strip.
    await surface.getByTestId("builtin-browser-new-tab").click();
    const tab = surface.getByTestId("builtin-browser-tab");
    await expect(tab).toHaveCount(1);
    expect(chrome.ops).toContain("open-tab");
    await expect(surface).toContainText("此标签页在你的 Chrome 中打开");
    await expect(surface.getByRole("button", { name: "在 Chrome 中显示" })).toBeVisible();

    // Its × closes it in Chrome.
    await tab.getByRole("button", { name: /^关闭标签页/ }).click();
    await expect(tab).toHaveCount(0);
    await expect.poll(() => chrome.ops.includes("close-tab")).toBe(true);
  } finally {
    chrome.ws.close();
  }
});
