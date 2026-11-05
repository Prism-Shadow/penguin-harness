/**
 * A workbench tab is a window beside Chat, and the docks belong to Chat (features/chat/
 * chat-page.tsx, the UI package's AppWindow and layers.css). Layering is what a real engine
 * computes, so these run in one.
 *
 * - Given a conversation with a dock open and its transcript scrolled, when a workbench tab is
 *   shown, nothing of Chat is on top anywhere over the page, focus cannot reach the dock, and
 *   when Chat is shown again the dock has its size and the transcript its scroll.
 * - The page is see-through: a page that paints no background leaves its root and body clear,
 *   in the app's color scheme, so the app's surface shows through it; a page that paints its own
 *   background keeps it.
 * - A dock shortcut pressed on a workbench tab switches to Chat, then toggles that dock there.
 * - The toolbar's details card, opened over a dock lifted to fullscreen, is on top of it.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "windowuser";
const P = "password123";
const REPLY = "Command finished; the result looks as expected.";

// ------------------------------------------------------------------ a zip, stored, no library

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** A zip of `files` (path → text), every entry stored uncompressed. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// ------------------------------------------------------------------ seed

const MANIFEST = {
  name: "window-demo",
  version: "1.0.0",
  type: "module",
  penguin: {
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
const tab = (page, name) => page.getByRole("tab", { name, exact: true });

async function openChat(page) {
  await provisionAndLogin(page.request, U, P);
  await page.goto(`${BASE}/chat/${sessionId}`);
  await expect(page.getByText(REPLY)).toBeVisible({ timeout: 30_000 });
  await expect(tab(page, "Clear")).toBeVisible({ timeout: 30_000 });
}

async function openDock(page, position, kind) {
  await page.getByTestId(`dock-toggle-${position}`).click();
  await page.getByTestId(`dock-pick-${kind}`).click();
  await expect(dockAt(page, position)).toBeVisible();
}

/** Each point of a grid over the page's frame where something other than the frame is on top. */
const coveredPoints = (page) =>
  page.evaluate(() => {
    const frame = document.querySelector("iframe[title]");
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

/** The frame document's root and body backgrounds and color schemes, and the frame element's. */
const frameSurface = (page) =>
  page.evaluate(() => {
    const frame = document.querySelector("iframe[title]");
    const doc = frame.contentDocument;
    return {
      root: getComputedStyle(doc.documentElement).backgroundColor,
      body: getComputedStyle(doc.body).backgroundColor,
      scheme: getComputedStyle(doc.documentElement).colorScheme,
      appScheme: getComputedStyle(frame).colorScheme,
    };
  });

test("a workbench tab hides Chat's docks whole, and Chat comes back as it was", async ({
  page,
}) => {
  await openChat(page);
  await openDock(page, "right", "trace");
  // Open the work group and a tool's output, so the transcript has somewhere to scroll to.
  await page.locator("[data-group-header]").click();
  await page.locator("button[aria-expanded]").filter({ hasText: "执行命令" }).first().click();
  const scroller = page.locator('[data-find-region="conversation"]');
  await scroller.evaluate((el) => (el.scrollTop = Math.floor(el.scrollHeight / 3)));
  const scrolled = await scroller.evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(0);
  const width = await dockAt(page, "right").evaluate((el) => el.getBoundingClientRect().width);

  await tab(page, "Clear").click();
  await expect(page.locator("iframe[title]")).toBeVisible();
  await page.waitForTimeout(300);
  expect(await coveredPoints(page)).toEqual([]);
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement?.closest('[data-testid="dock"]') ?? null),
  ).toBeNull();

  await tab(page, "聊天").click();
  await expect(dockAt(page, "right")).toBeVisible();
  expect(await dockAt(page, "right").evaluate((el) => el.getBoundingClientRect().width)).toBe(
    width,
  );
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(scrolled);
});

test("the page is see-through unless it paints its own background", async ({ page }) => {
  await openChat(page);
  await tab(page, "Clear").click();
  await expect(page.locator("iframe[title]")).toBeVisible();
  await expect.poll(() => frameSurface(page).then((s) => s.body)).toBe("rgba(0, 0, 0, 0)");
  const clear = await frameSurface(page);
  expect(clear.root).toBe("rgba(0, 0, 0, 0)");
  expect(clear.scheme).toBe(clear.appScheme);

  await tab(page, "Solid").click();
  await expect.poll(() => frameSurface(page).then((s) => s.body)).toBe("rgb(1, 2, 3)");
});

test("a dock shortcut on a workbench tab switches to Chat, then toggles that dock", async ({
  page,
}) => {
  await openChat(page);
  await openDock(page, "right", "trace");
  await tab(page, "Clear").click();
  await expect(page.locator("iframe[title]")).toBeVisible();

  await page.keyboard.press("Control+Alt+Digit2");

  await expect(tab(page, "聊天")).toHaveAttribute("aria-selected", "true");
  await expect(dockAt(page, "right")).toHaveCount(0);
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
