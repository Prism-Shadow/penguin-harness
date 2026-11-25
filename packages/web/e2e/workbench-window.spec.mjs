/** The real window host, Apps rows, and workbench subpages in the conversation workspace. */
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
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
const boardDocument = (style, title = "Board") =>
  `<!doctype html><html><head><meta charset="utf-8">${style}</head><body><h1>${title}</h1><p>Rows.</p></body></html>`;

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
        "window-demo/ui/clear.html": boardDocument(""),
        "window-demo/ui/solid.html": boardDocument(
          "<style>body { background: rgb(1, 2, 3); }</style>",
        ),
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
const row = (page, key = KEY) =>
  page.getByRole("navigation", { name: "应用", exact: true }).locator(`[data-app-row="${key}"]`);
async function launchFromChat(page) {
  await page.getByRole("button", { name: "快捷方式", exact: true }).click();
  await page.getByRole("button", { name: "打开应用中心", exact: true }).click();
  await page
    .getByRole("list", { name: "应用中心", exact: true })
    .locator(`li[data-app="${KEY}"] > button`)
    .first()
    .click();
}
async function action(page, name, key = KEY) {
  const item = row(page, key);
  await item.hover();
  await item.locator("xpath=ancestor::li").getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
/** The app's window: named by its App Center title, which the manifest declares. */
const appWindow = (page) => page.getByRole("region", { name: "Window demo" });

async function openChat(page) {
  await provisionAndLogin(page.request, U, P);
  await page.goto(`${BASE}/chat/${sessionId}`);
  await expect(page.getByText(REPLY)).toBeVisible({ timeout: 30_000 });
  await expect(row(page)).toHaveCount(0);
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

test("the workbench opened beside a conversation returns to its docked App Center on minimize and close", async ({
  page,
}) => {
  await openChat(page);
  // The conversation has no tab strip of its own.
  await expect(page.getByRole("tablist", { name: "聊天与工作台" })).toHaveCount(0);
  await openDock(page, "right", "trace");
  await page.getByTestId("dock-toggle-right").click();
  await expect(dockAt(page, "right")).toHaveCount(0);

  await launchFromChat(page);
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/apps" &&
      url.searchParams.get("app") === KEY &&
      url.searchParams.get("beside") === sessionId,
  );
  await expect(appWindow(page).locator("iframe[title='Clear']")).toBeVisible();
  await page.waitForTimeout(300);
  expect(await coveredPoints(page)).toEqual([]);
  await expect(row(page)).toHaveAttribute("aria-current", "page");
  // Tag the frame's document, to tell the same frame from a new one.
  await appWindow(page)
    .locator("iframe[title='Clear']")
    .evaluate((f) => (f.contentWindow.__tag = "kept"));

  await action(page, "最小化");
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/apps" &&
      !url.searchParams.has("app") &&
      url.searchParams.get("beside") === sessionId,
  );
  await expect(page.getByRole("list", { name: "应用中心", exact: true })).toBeVisible();
  // Exact: the Trace dock's row for the reply previews the same text.
  await expect(
    page
      .locator(`[data-workspace-page="chat:${sessionId}"]`)
      .getByText(REPLY, { exact: true })
      .first(),
  ).toBeVisible();
  await expect(row(page)).toHaveAttribute("aria-label", "Window demo，运行中");

  await row(page).click();
  await expect(
    appWindow(page)
      .locator("iframe[title='Clear']")
      .evaluate((f) => f.contentWindow.__tag),
  ).resolves.toBe("kept");

  await action(page, "关闭");
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/apps" &&
      !url.searchParams.has("app") &&
      url.searchParams.get("beside") === sessionId,
  );
  await expect(page.getByRole("list", { name: "应用中心", exact: true })).toBeVisible();
  await expect(page.locator("iframe[title='Clear']")).toHaveCount(0);
  await dockAt(page, "right")
    .locator('[data-tab-id=":catalog"]')
    .getByTestId("dock-tab-close")
    .click();
  await expect(page).toHaveURL(`${BASE}/chat/${sessionId}`);
  await page.getByTestId("dock-toggle-right").click();
  await expect(dockAt(page, "right").locator('[data-tab-id="trace"]')).toBeVisible();
});

test("the page is see-through unless it paints its own background, and the bar switches pages", async ({
  page,
}) => {
  await openChat(page);
  await launchFromChat(page);
  await expect(appWindow(page).locator("iframe[title='Clear']")).toBeVisible();
  await expect.poll(() => frameSurface(page).then((s) => s.body)).toBe("rgba(0, 0, 0, 0)");
  const clear = await frameSurface(page);
  expect(clear.root).toBe("rgba(0, 0, 0, 0)");
  expect(clear.scheme).toBe(clear.appScheme);

  await appWindow(page).getByRole("button", { name: "Solid", exact: true }).click();
  await expect(appWindow(page).locator("iframe[title='Solid']")).toBeVisible();
  await expect.poll(() => frameSurface(page).then((s) => s.body)).toBe("rgb(1, 2, 3)");
  await action(page, "关闭");
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

test("opening a workbench in a second window leaves the first window's Apps list alone", async ({
  page,
  context,
}) => {
  await openChat(page);
  const settings = await context.newPage();
  await settings.goto(`${BASE}/agents/default_agent?tab=workbenches`);
  await settings.getByRole("button", { name: "更多 Clear" }).click();
  await expect(settings.getByRole("menuitemcheckbox", { name: "展示到侧边栏" })).toHaveCount(0);
  await settings.keyboard.press("Escape");
  await settings.getByRole("button", { name: "打开工作台 Clear", exact: true }).click();
  await expect(row(settings)).toHaveCount(1);
  await expect(row(page)).toHaveCount(0);
  await page.goto(`${BASE}/apps`);
  await page.locator(`li[data-app="${KEY}"] > button`).first().click();
  await expect(row(page)).toHaveCount(1);
  const appLink = page.url();
  await page.goto("about:blank");
  await page.goto(appLink);
  await expect(
    page.frameLocator("iframe[title='Clear']").getByRole("heading", { name: "Board" }),
  ).toBeVisible();
  await action(page, "关闭");
  await expect(row(page)).toHaveCount(0);
  await expect(row(settings)).toHaveCount(1);
  await settings.close();
});

test("a running workbench's Apps row exposes versions, a portable download and scoped removal", async ({
  page,
}) => {
  await openChat(page);
  await launchFromChat(page);
  const window = appWindow(page);
  // The pane draws the page switcher and nothing else above the app.
  await expect(window.getByRole("button", { name: /更多/ })).toHaveCount(0);
  await action(page, "历史版本");
  const history = page.getByRole("dialog");
  await expect(history.getByText("当前", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await row(page).hover();
  await row(page).locator("xpath=ancestor::li").getByRole("button", { name: "更多操作" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "下载到本地（ZIP）" }).click(),
  ]);
  const body = await readFile(await download.path());
  expect(download.suggestedFilename()).toMatch(/window-demo.*\.zip$/);
  const agent = "download_review";
  const agentRoot = `${BASE}/api/projects/${projectId}/agents`;
  const created = await page.request.post(agentRoot, {
    data: { agentId: agent, name: "Review copy" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const copy = `${agentRoot}/${agent}/workbenches`;
  const imported = await page.request.post(`${copy}/archive`, {
    data: { dataBase64: body.toString("base64") },
  });
  expect(imported.ok(), await imported.text()).toBeTruthy();
  const changed = await page.request.post(`${copy}/archive`, {
    data: {
      overwrite: true,
      dataBase64: zip({
        "window-demo/package.json": JSON.stringify({ ...MANIFEST, version: "1.1.0" }),
        "window-demo/index.ts": INDEX,
        "window-demo/ui/clear.html": boardDocument("", "Second edition"),
        "window-demo/ui/solid.html": boardDocument(""),
      }).toString("base64"),
    },
  });
  expect(changed.ok(), await changed.text()).toBeTruthy();
  const copyKey = `${agent}/window-demo`;
  await page.goto(`${BASE}/apps`);
  await page.locator(`li[data-app="${copyKey}"] > button`).first().click();
  const board = (name) => page.frameLocator("iframe[title='Clear']").getByRole("heading", { name });
  await expect(board("Second edition")).toBeVisible();
  await action(page, "历史版本", copyKey);
  await page.getByRole("dialog").getByRole("button", { name: "恢复", exact: true }).last().click();
  await page
    .getByRole("dialog", { name: "恢复版本" })
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await expect(board("Board")).toBeVisible();
  await action(page, "移除工作台", copyKey);
  await expect(page.getByRole("dialog")).toContainText(agent);
  await page.keyboard.press("Escape");
  await expect(board("Board")).toBeVisible();
  await action(page, "移除工作台", copyKey);
  await page.getByRole("dialog").getByRole("button", { name: "确认移除" }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${copy}?id=window-demo`)).json()).workbenches.length,
    )
    .toBe(0);
  await expect(row(page, copyKey)).toHaveCount(0);
  expect(
    (await (await page.request.get(`${agentRoot}/default_agent/workbenches?id=window-demo`)).json())
      .workbenches,
  ).toHaveLength(1);
  expect((await page.request.get(`${BASE}/api/sessions/${sessionId}`)).status()).toBe(200);
});
