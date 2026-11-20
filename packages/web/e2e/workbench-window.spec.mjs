/**
 * An Agent's app opened from the sidebar's app list, in the App Center's window over the main
 * area (features/session-list/main-sidebar-apps.tsx, features/app-center/app-center-windows.tsx,
 * the UI package's AppWindow and layers.css). Layering is what a real engine computes, so these
 * run in one.
 *
 * - The conversation has no tab strip; the sidebar lists the Agent's app. Its row opens the
 *   window over the main area, where nothing of the page is on top anywhere over the app's page;
 *   minimize returns to the conversation with the row marked running and the same frame alive,
 *   the row brings that frame back, and close returns to the conversation.
 * - The page is see-through: a page that paints no background leaves its root and body clear,
 *   in the app's color scheme, so the app's surface shows through it; a page that paints its own
 *   background keeps it. The window's title bar switches between the app's two pages.
 * - The toolbar's details card, opened over a dock lifted to fullscreen, is on top of it.
 * - Hiding a workbench from its Agent's sidebar, from the More menu of its settings row (by
 *   keyboard alone at desktop width; the menu inside the screen at phone width), takes its row
 *   off the sidebar at once and leaves its App Center setting alone. A reloaded conversation
 *   downloads none of its pages; the row's Open, its App Center tile and a reloaded window link
 *   still open it; shown in the sidebar again, it is a row again.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { watchSocket } from "./api-socket.mjs";
import { zip } from "./workbench-zip.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "windowuser";
const P = "password123";
const REPLY = "Command finished; the result looks as expected.";

// ------------------------------------------------------------------ seed

const MANIFEST = {
  name: "window-demo",
  version: "1.0.0",
  type: "module",
  penguin: {
    appCenter: { show: true, title: "Window demo" },
    modules: [
      {
        name: "Workbench",
        requires: { host: { iface: "@prismshadow/penguin-server#WorkbenchHost", from: "Host" } },
        provides: { main: "@prismshadow/penguin-server#WorkbenchMain" },
        contributes: {
          "WebModule.sessionTabs": [
            {
              id: "w.clear",
              key: "clear",
              title: "Clear",
              renderer: { iframe: { src: "ui/clear.html" } },
            },
            {
              id: "w.solid",
              key: "solid",
              title: "Solid",
              renderer: { iframe: { src: "ui/solid.html" } },
            },
          ],
        },
      },
    ],
  },
};
const INDEX = `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";
export default {
  modules: { Workbench: { create() { return { api: { main: { async handle() { return { body: null }; } } } }; } } },
} satisfies WorkbenchPackage;
`;
const page = (style) =>
  `<!doctype html><html><head><meta charset="utf-8">${style}</head><body><h1>Board</h1><p>Rows.</p></body></html>`;

let projectId;
let sessionId;

test.beforeAll(async ({ browser }) => {
  const seed = await browser.newPage();
  await provisionAndLogin(seed.request, U, P);
  projectId = (await (await seed.request.get(`${BASE}/api/projects`)).json()).projects[0].projectId;
  const models = await seed.request.put(`${BASE}/api/projects/${projectId}/models`, {
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
  expect(models.ok(), await models.text()).toBeTruthy();
  const base = `${BASE}/api/projects/${projectId}/agents/default_agent/workbenches`;
  const imported = await seed.request.post(`${base}/archive`, {
    data: {
      overwrite: true,
      dataBase64: zip({
        "window-demo/package.json": JSON.stringify(MANIFEST),
        "window-demo/index.ts": INDEX,
        "window-demo/ui/clear.html": page(""),
        "window-demo/ui/solid.html": page("<style>body { background: rgb(1, 2, 3); }</style>"),
      }).toString("base64"),
    },
  });
  expect(imported.ok(), await imported.text()).toBeTruthy();
  const created = await seed.request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" } },
  );
  expect(created.ok(), await created.text()).toBeTruthy();
  sessionId = (await created.json()).session.sessionId;
  await seed.goto(`${BASE}/chat/${sessionId}`);
  await seed.getByPlaceholder(/输入消息/).fill("sticky rows test");
  await seed.getByRole("button", { name: "发送", exact: true }).click();
  await expect(seed.getByText(REPLY)).toBeVisible({ timeout: 60_000 });
  await seed.close();
});

const dockAt = (page, position) =>
  page.locator(`[data-testid="dock"][data-position="${position}"][data-open="true"]`);
const KEY = "default_agent/window-demo";
const row = (page) => page.locator(`[data-app-row="${KEY}"]`);
/** The app's window: named by its App Center title, which the manifest declares. */
const appWindow = (page) => page.getByRole("region", { name: "Window demo" });

async function openChat(page) {
  await provisionAndLogin(page.request, U, P);
  await page.goto(`${BASE}/chat/${sessionId}`);
  await expect(page.getByText(REPLY)).toBeVisible({ timeout: 30_000 });
  await expect(row(page)).toBeVisible({ timeout: 30_000 });
}

async function openDock(page, position, kind) {
  await page.getByTestId(`dock-toggle-${position}`).click();
  await page.getByTestId(`dock-pick-${kind}`).click();
  await expect(dockAt(page, position)).toBeVisible();
}

/** Each point of a grid over the shown page's frame where something other than it is on top. */
const coveredPoints = (page) =>
  page.evaluate(() => {
    const frame = [...document.querySelectorAll("iframe[title]")].find(
      (f) => f.closest('[data-window][data-shown="true"]') !== null,
    );
    const box = frame.getBoundingClientRect();
    const covered = [];
    for (let fy = 0.05; fy < 1; fy += 0.15) {
      for (let fx = 0.05; fx < 1; fx += 0.15) {
        const at = document.elementFromPoint(box.left + box.width * fx, box.top + box.height * fy);
        if (at !== frame) covered.push(at?.outerHTML.slice(0, 80) ?? "nothing");
      }
    }
    return covered;
  });

/** The shown frame document's root and body backgrounds and color schemes, and the frame's. */
const frameSurface = (page) =>
  page.evaluate(() => {
    const frame = [...document.querySelectorAll("iframe[title]")].find(
      (f) => f.closest('[data-window][data-shown="true"]') !== null,
    );
    const doc = frame.contentDocument;
    return {
      root: getComputedStyle(doc.documentElement).backgroundColor,
      body: getComputedStyle(doc.body).backgroundColor,
      scheme: getComputedStyle(doc.documentElement).colorScheme,
      appScheme: getComputedStyle(frame).colorScheme,
    };
  });

test("the sidebar's row opens the app's window over the conversation, minimize keeps it running, close returns", async ({
  page,
}) => {
  await openChat(page);
  // The conversation has no tab strip of its own.
  await expect(page.getByRole("tablist", { name: "聊天与工作台" })).toHaveCount(0);
  await openDock(page, "right", "trace");

  await row(page).click();
  await expect(page).toHaveURL(`${BASE}/apps?app=${encodeURIComponent(KEY)}`);
  await expect(appWindow(page).locator("iframe[title='Clear']")).toBeVisible();
  await page.waitForTimeout(300);
  expect(await coveredPoints(page)).toEqual([]);
  await expect(row(page)).toHaveAttribute("aria-current", "page");
  // Tag the frame's document, to tell the same frame from a new one.
  await appWindow(page)
    .locator("iframe[title='Clear']")
    .evaluate((f) => (f.contentWindow.__tag = "kept"));

  await appWindow(page).getByRole("button", { name: "最小化", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/chat/${sessionId}`);
  await expect(page.getByText(REPLY)).toBeVisible();
  await expect(row(page)).toHaveAttribute("aria-label", "Window demo，运行中");

  await row(page).click();
  await expect(
    appWindow(page)
      .locator("iframe[title='Clear']")
      .evaluate((f) => f.contentWindow.__tag),
  ).resolves.toBe("kept");

  await appWindow(page).getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/chat/${sessionId}`);
  await expect(page.locator("iframe[title='Clear']")).toHaveCount(0);
  await expect(dockAt(page, "right")).toBeVisible();
});

test("the page is see-through unless it paints its own background, and the bar switches pages", async ({
  page,
}) => {
  await openChat(page);
  await row(page).click();
  await expect(appWindow(page).locator("iframe[title='Clear']")).toBeVisible();
  await expect.poll(() => frameSurface(page).then((s) => s.body)).toBe("rgba(0, 0, 0, 0)");
  const clear = await frameSurface(page);
  expect(clear.root).toBe("rgba(0, 0, 0, 0)");
  expect(clear.scheme).toBe(clear.appScheme);

  await appWindow(page).getByRole("button", { name: "Solid", exact: true }).click();
  await expect(appWindow(page).locator("iframe[title='Solid']")).toBeVisible();
  await expect.poll(() => frameSurface(page).then((s) => s.body)).toBe("rgb(1, 2, 3)");
  await appWindow(page).getByRole("button", { name: "关闭", exact: true }).click();
});

test("the toolbar's details card opens on top of a dock lifted to fullscreen", async ({ page }) => {
  await openChat(page);
  await openDock(page, "bottom", "trace");
  await dockAt(page, "bottom").getByTestId("dock-fullscreen").click();
  await expect(page.locator('[data-testid="dock"][data-fullscreen="full"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Session 信息" }).click();
  const card = page.getByRole("button", { name: "复制 Session ID" });
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  const onTop = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(onTop).toBe("复制 Session ID");
});

test("a workbench hidden from the sidebar leaves the list, and its row's Open, App Center tile and window link still open it", async ({
  page,
  context,
}) => {
  await openChat(page);
  const settings = await context.newPage();
  await settings.setViewportSize({ width: 1280, height: 900 });
  await settings.goto(`${BASE}/agents/default_agent?tab=workbenches`);
  const more = settings.getByRole("button", { name: "更多 Clear" });
  const menu = settings.getByRole("menu", { name: "更多 Clear" });
  const sidebar = menu.getByRole("menuitemcheckbox", { name: "展示到侧边栏" });
  const appCenter = menu.getByRole("menuitemcheckbox", { name: "展示到应用中心" });
  try {
    await more.focus();
    await settings.keyboard.press("Enter");
    await expect(appCenter).toBeFocused();
    await settings.keyboard.press("ArrowDown");
    await expect(sidebar).toBeFocused();
    await expect(sidebar).toBeChecked();
    // A pick writes and closes the menu.
    await settings.keyboard.press("Space");
    await expect(menu).toHaveCount(0);
    await expect(row(page)).toHaveCount(0);
    await expect(page.getByText(REPLY)).toBeVisible();

    await settings.setViewportSize({ width: 320, height: 760 });
    await more.click();
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(sidebar).not.toBeChecked();
    await expect(appCenter).toBeChecked();
    await settings.keyboard.press("Escape");
    await settings.setViewportSize({ width: 1280, height: 900 });

    const socket = await watchSocket(page);
    const resources = [];
    socket.onCall((call) => {
      if (call.path.includes("/workbenches/window-demo/")) resources.push(call.path);
    });
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.includes("/workbenches/window-demo/")) resources.push(r.url());
    });
    await Promise.all([
      socket.nextAnswer((call) => call.path.endsWith("/workbenches?view=sidebar")),
      page.reload(),
    ]);
    await expect(page.getByText(REPLY)).toBeVisible();
    await expect(row(page)).toHaveCount(0);
    expect(resources).toEqual([]);

    // Hidden from the sidebar, the row's Open still opens its window.
    await settings.reload();
    await settings.getByRole("button", { name: "打开工作台 Clear" }).click();
    await expect(settings).toHaveURL(`${BASE}/apps?app=${encodeURIComponent(KEY)}`);
    await expect(
      settings.frameLocator("iframe[title='Clear']").getByRole("heading", { name: "Board" }),
    ).toBeVisible();
    await appWindow(settings).getByRole("button", { name: "关闭", exact: true }).click();
    await expect(settings).toHaveURL(`${BASE}/agents/default_agent?tab=workbenches`);

    await page.goto(`${BASE}/apps`);
    const tile = page.getByRole("button", { name: /^Window demo/ });
    await tile.click();
    await expect(
      page.frameLocator("iframe[title='Clear']").getByRole("heading", { name: "Board" }),
    ).toBeVisible();
    expect(resources.some((url) => url.includes("/ui/clear.html"))).toBe(true);
    const appLink = page.url();
    await page.goto("about:blank");
    await page.goto(appLink);
    await expect(
      page.frameLocator("iframe[title='Clear']").getByRole("heading", { name: "Board" }),
    ).toBeVisible();

    await more.click();
    await sidebar.click();
    await more.click();
    await expect(sidebar).toBeChecked();
    // Settled: the write is no longer in flight.
    await expect(sidebar).toBeEnabled();
    await settings.keyboard.press("Escape");
    await page.goto(`${BASE}/chat/${sessionId}`);
    await expect(row(page)).toBeVisible();
  } finally {
    await page.request.patch(
      `${BASE}/api/projects/${projectId}/agents/default_agent/workbenches/window-demo/sidebar`,
      { data: { show: true } },
    );
    await settings.close();
  }
});
