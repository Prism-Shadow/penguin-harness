/**
 * End-to-end tests for the App Center (/apps), against the real server (locale en).
 *
 * - The admin's default Project lists the shipped Support workbench as a tile with its own icon,
 *   served by the icon route. A click opens it windowed over the grid; the window's minimize
 *   returns to the grid with the tile marked running, and the tile brings back the same frame;
 *   the window's close returns to the grid; "Open full screen" in the tile's menu opens the full
 *   page, whose exit comes back to the App Center. Manage apps opens the Plugin Market. Workbench settings can open a hidden workbench.
 * - With three workbenches of a fresh account's Agent: a real pointer drag of one tile onto the
 *   middle of another rings the target while it hovers and makes a folder on release, which
 *   opens as a panel over the grid; the menu moves a tile backward; the arrangement outlives a
 *   reload; restoring the default order asks first and then clears it. After several pages of
 *   navigation inside a grouped app, its close button still returns directly to its tile.
 * - The header's New folder makes a folder of the apps checked in its dialog, under the name
 *   typed there, at the first checked app's place.
 * - An old folder containing the built-in Files tile still opens a separately installed Files app.
 * - A system app's tile opens its own page, where the nav keeps the App Center lit, Benchmark
 *   detail pages included.
 */
import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
import { zip } from "./workbench-zip.mjs";

const BASE = process.env.BASE_URL;
const SUPPORT = "/agents/penguin_support?tab=workbenches";

/** The Workbenches sub-page of Support's Agent, which lists the workbench's row. */
async function openSupportRow(page) {
  await page.goto(`${BASE}${SUPPORT}`);
}

test("the App Center opens Support windowed or full screen, and a hidden workbench remains accessible from settings", async ({
  page,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });

  await page.goto(`${BASE}/apps`);
  const grid = page.getByRole("list", { name: "App Center" });
  const tile = grid.getByRole("button", { name: /^Support/ });
  await expect(tile).toBeVisible();
  await expect(tile).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
  // Its own icon, an image the icon route serves, rather than a letter.
  const icon = tile.locator("img");
  await expect(icon).toHaveAttribute("src", /\/workbenches\/support\/app-center\/icon\?rev=/);
  expect(await icon.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);

  await tile.click();
  await expect(page).toHaveURL(/\/apps\?app=penguin_support%2Fsupport$/);
  const appWindow = page.getByRole("region", { name: "Support" });
  await expect(appWindow.locator("iframe")).toBeVisible();
  // Minimized, the app keeps running: the frame it comes back with is the same element.
  await appWindow.locator("iframe").evaluate((frame) => {
    frame.dataset.e2eKept = "yes";
  });
  await page
    .getByRole("navigation", { name: "Apps", exact: true })
    .locator('[data-app-row="penguin_support/support"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Minimize", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/apps`);
  await expect(grid.getByRole("button", { name: /^Support, .+, Running$/ })).toBeVisible();
  await tile.click();
  await expect(appWindow.locator('iframe[data-e2e-kept="yes"]')).toBeVisible();
  await page
    .getByRole("navigation", { name: "Apps", exact: true })
    .locator('[data-app-row="penguin_support/support"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/apps`);
  await expect(grid.getByRole("button", { name: /^Support, .+, Running$/ })).toHaveCount(0);

  await tile.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open full screen" }).click();
  await expect(page).toHaveURL(/\/app\/default_project\/penguin_support\/support$/);
  await page.getByRole("button", { name: "Exit full screen" }).click();
  await expect(page).toHaveURL(`${BASE}/apps`);

  await tile.click();
  const apps = page.getByRole("navigation", { name: "Apps", exact: true });
  await apps.getByRole("button", { name: "Manage apps" }).click();
  await expect(page).toHaveURL(`${BASE}/plugins`);
  await page.goto(`${BASE}/apps`);
  await tile.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from the App Center" }).click();
  await expect(tile).toHaveCount(0);
  let restored = false;
  try {
    await openSupportRow(page);
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Open workbench Support", exact: true }) });
    await expect(row.getByRole("switch")).toBeVisible();
    await expect(row.getByRole("button", { name: /Hide|Unhide|More/ })).toHaveCount(0);
    const title = row.getByRole("button", { name: /^Support(?: |$)/ });
    await title.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Support" }).getByRole("button", { name: "More Support" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await row.getByRole("button", { name: "Open workbench Support" }).click();
    await expect(appWindow.locator("iframe")).toBeVisible();
    await page.goto(`${BASE}/apps`);
    await page.getByRole("button", { name: "Hidden workbenches", exact: true }).click();
    const hidden = page.getByRole("dialog", { name: "Hidden workbenches" });
    const support = hidden.getByRole("listitem").filter({ hasText: "Support" });
    await support.getByRole("button", { name: "Show in App Center" }).click();
    await expect(support).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(tile).toBeVisible();
    restored = true;
  } finally {
    if (!restored) {
      const restore = await page.request.patch(
        `${BASE}/api/projects/default_project/agents/penguin_support/workbenches/support/app-center`,
        { data: { show: true } },
      );
      expect(restore.ok()).toBe(true);
    }
  }
});

// ------------------------------------------------------------------ three apps of one Agent

const U = "appcenteruser";
const P = "password123";
const APPS = ["Alpha", "Beta", "Gamma"];

const manifest = (title) => ({
  name: title.toLowerCase(),
  version: "1.0.0",
  type: "module",
  penguin: {
    appCenter: { show: true },
    modules: [
      {
        name: "Workbench",
        requires: { host: { iface: "@prismshadow/penguin-server#WorkbenchHost", from: "Host" } },
        provides: { main: "@prismshadow/penguin-server#WorkbenchMain" },
        contributes: {
          "WebModule.sessionTabs": [
            {
              id: `${title.toLowerCase()}.main`,
              key: "main",
              title,
              renderer: { iframe: { src: "ui/index.html" } },
            },
          ],
        },
      },
    ],
  },
});
const INDEX = `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";
export default {
  modules: { Workbench: { create() { return { api: { main: { async handle() { return { body: null }; } } } }; } } },
} satisfies WorkbenchPackage;
`;

async function importApp(request, base, title, id = title.toLowerCase()) {
  const imported = await request.post(`${base}/archive`, {
    data: {
      overwrite: true,
      dataBase64: zip({
        [`${id}/package.json`]: JSON.stringify(manifest(title)),
        [`${id}/index.ts`]: INDEX,
        [`${id}/ui/index.html`]: `<!doctype html><html><body><h1>${title}</h1>
            <a href="#read">Read</a><a href="#review">Review</a><a href="#saved">Saved</a>
            </body></html>`,
      }).toString("base64"),
    },
  });
  expect(imported.ok(), await imported.text()).toBeTruthy();
}

test.beforeAll(async ({ browser }) => {
  const seed = await browser.newPage();
  await provisionAndLogin(seed.request, U, P);
  const projectId = (await (await seed.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
  const project = `${BASE}/api/projects/${projectId}`;
  const { shortcuts } = await (await seed.request.get(`${project}/app-center`)).json();
  // This fixture tests the exact order of three apps. Fresh Projects can also ship workbenches.
  for (const { agentId, workbenchId } of shortcuts) {
    if (agentId === "default_agent" && APPS.some((title) => title.toLowerCase() === workbenchId))
      continue;
    const hidden = await seed.request.patch(
      `${project}/agents/${agentId}/workbenches/${workbenchId}/app-center`,
      {
        data: { show: false },
      },
    );
    expect(hidden.ok(), await hidden.text()).toBeTruthy();
  }
  const base = `${project}/agents/default_agent/workbenches`;
  for (const title of APPS) await importApp(seed.request, base, title);
  await seed.close();
});

test("an installed Files app takes its old folder’s slot when the retired built-in tile was its other member", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "filescatalog", P);
  await setAccountPrefs(page.request, { lang: "en" });
  const { projects } = await (await page.request.get("/api/projects")).json();
  const base = "/api/projects/" + projects[0].projectId;
  const builtin = "system_agent/session-tools-workspace";
  const installed = "default_agent/session-tools-workspace";
  await importApp(
    page.request,
    base + "/agents/default_agent/workbenches",
    "Files",
    "session-tools-workspace",
  );
  const layout = {
    v: 1,
    items: [{ type: "folder", id: "tools", name: "Tools", apps: [builtin, installed] }],
  };
  await expect(await page.request.put(base + "/app-center/layout", { data: { layout } })).toBeOK();
  await page.goto("/apps");
  await expect(page.locator('[data-folder="tools"]')).toHaveCount(0);
  const tile = page.locator(`li[data-app="${installed}"] > button`).first();
  await expect(tile).toBeVisible();
  await expect(page.locator(`li[data-app="${builtin}"]`)).toHaveCount(0);
  await tile.click();
  await expect(page.locator(`[data-workspace-page="app:${installed}"] iframe`)).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get(base + "/app-center")).json()).layout)
    .toEqual({ v: 1, items: [{ type: "app", app: installed }] });
  await page.goto("/session-tools/workspace");
  await expect(
    page.getByRole("region", { name: "Files", exact: true }).getByRole("searchbox"),
  ).toBeVisible();
});

test("an installed game's canvas captures the mouse on click only when its tab opts in", async ({
  playwright,
}) => {
  // Chromium's headless window has no native pointer to capture. On display-less Linux
  // this case can be run under xvfb-run.
  test.skip(
    process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    "Native pointer capture requires a window",
  );
  const browser = await playwright.chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();
    await provisionAndLogin(page.request, "pointergame", P);
    await setAccountPrefs(page.request, { lang: "en" });
    const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
      .projectId;
    const base = `${BASE}/api/projects/${projectId}/agents/default_agent/workbenches`;
    const gameHtml = `<!doctype html><canvas tabindex="0" width="400" height="200" aria-label="Game"></canvas>
    <script>
      const canvas = document.querySelector("canvas");
      canvas.onclick = async () => {
        try {
          await canvas.requestPointerLock();
          canvas.dataset.result = document.pointerLockElement === canvas ? "captured" : "released";
        } catch (error) { canvas.dataset.result = error.name; canvas.title = error.message; }
      };
    </script>`;
    for (const [name, optIn] of [
      ["Board", false],
      ["Game", true],
    ]) {
      const pkg = manifest(name);
      const renderer = pkg.penguin.modules[0].contributes["WebModule.sessionTabs"][0].renderer;
      if (optIn) renderer.iframe.pointerLock = true;
      const id = pkg.name;
      const imported = await page.request.post(`${base}/archive`, {
        data: {
          dataBase64: zip({
            [`${id}/package.json`]: JSON.stringify(pkg),
            [`${id}/index.ts`]: INDEX,
            [`${id}/ui/index.html`]: gameHtml,
          }).toString("base64"),
          overwrite: true,
        },
      });
      expect(imported.ok(), await imported.text()).toBeTruthy();
      await page.goto(`${BASE}/apps`);
      await page.getByRole("button", { name: new RegExp(`^${name},`) }).click();
      const frame = page.getByRole("region", { name }).frameLocator("iframe");
      const canvas = frame.locator("canvas");
      expect(await canvas.evaluate(() => document.pointerLockElement)).toBeNull();
      await page.bringToFront();
      await canvas.focus();
      await canvas.click();
      await expect(canvas).toHaveAttribute("data-result", optIn ? "captured" : "SecurityError");
      if (optIn) {
        await canvas.evaluate(() => document.exitPointerLock());
        await expect.poll(() => canvas.evaluate(() => document.pointerLockElement)).toBeNull();
      }
    }
  } finally {
    await browser.close();
  }
});

test("tiles drag into a folder, step through the menu, keep their order, and restore after asking", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  await setAccountPrefs(page.request, { lang: "en", themeId: "doodle" });
  await page.goto(`${BASE}/apps`);
  const grid = page.getByRole("list", { name: "App Center" });
  const tile = (name) => grid.getByRole("button", { name: new RegExp(`^${name},`) });
  const names = () =>
    grid
      // The workbenches' tiles and folders: the system apps lead the grid untouched.
      .locator(':scope > li:not([data-app^="system_agent/"])')
      .evaluateAll((items) =>
        items.map((li) => li.querySelector(":scope > button > span:last-child")?.textContent ?? ""),
      );
  for (const name of APPS) {
    await expect(tile(name)).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
  }
  expect(await names()).toEqual(APPS);

  // Gamma dragged by the pointer onto the middle of Alpha: while it hovers, Alpha wears the ring
  // of a drop into it; on release, a folder of the two, in Alpha's place.
  const item = (id) => grid.locator(`li[data-app="default_agent/${id}"]`);
  const from = await item("gamma").boundingBox();
  const to = await item("alpha").boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  // A browser repeats dragover while the pointer rests; Playwright's drag sends the last one with
  // the next input, so a one-pixel nudge delivers it.
  await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height / 2);
  await expect(item("alpha")).toHaveAttribute("data-drop", "into");
  await page.mouse.up();
  await expect.poll(names).toEqual(["New folder", "Beta"]);

  const folder = grid.getByRole("button", { name: /^New folder, folder, 2 apps/ });
  // Inspect the two ends of the actual CSS transitions without racing the display refresh.
  const slow = await page.addStyleTag({
    content:
      "[data-unfold-surface][data-layout-motion], [data-unfold-surface] [data-layout-motion] { transition-duration: 2s; }",
  });
  await folder.click();
  const panel = page.getByRole("region", { name: "New folder" });
  const positions = await panel.evaluate((node) => {
    const animations = node.getAnimations({ subtree: true });
    for (const part of animations) {
      part.pause();
      part.currentTime = 0;
    }
    const trigger = document.querySelector(`[aria-controls="${node.id}"]`);
    const bounds = (el) => {
      const { x, y, width } = el.getBoundingClientRect();
      const radius =
        (parseFloat(getComputedStyle(el).borderTopLeftRadius) * width) / el.offsetWidth;
      return [x, y, width, radius].map(Math.round);
    };
    const pairs = [...trigger.querySelectorAll("[data-unfold-source]")].map((mini) => {
      const slot = [...node.querySelectorAll("[data-unfold-art]")].find(
        (el) => el.dataset.unfoldArt === mini.dataset.unfoldSource,
      );
      return [
        bounds(mini.querySelector("[data-app-icon-shape]")),
        bounds(slot.firstElementChild.querySelector("[data-app-icon-shape]")),
      ];
    });
    for (const part of animations) part.finish();
    return pairs;
  });
  for (const [preview, icon] of positions) {
    expect(icon).toEqual(preview);
    // The projected corner matches the preview and leaves a straight side on the 20px tile.
    expect(icon[3]).toBeLessThanOrEqual(icon[2] / 4);
  }
  await slow.evaluate((style) => style.remove());
  await expect(panel.getByRole("button", { name: /^Alpha,/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Gamma,/ })).toBeVisible();
  await panel.getByRole("button", { name: /^Gamma,/ }).click();
  const window = page.getByRole("region", { name: "Gamma" });
  const inside = window.frameLocator("iframe");
  await expect(inside.getByRole("heading", { name: "Gamma" })).toBeVisible();
  for (const name of ["Read", "Review", "Saved"]) await inside.getByRole("link", { name }).click();
  // Browser Back navigates the app's pages. The host's close leaves the whole app in one step.
  await page.evaluate(() => history.back());
  await expect.poll(() => inside.locator("body").evaluate(() => location.hash)).toBe("#review");
  await page
    .getByRole("navigation", { name: "Apps", exact: true })
    .locator('[data-app-row="default_agent/gamma"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close", exact: true }).click();
  await expect(panel.getByRole("button", { name: /^Gamma,/ })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(folder).toBeFocused();
  await folder.press("Enter");
  await page.goBack();
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();

  // The folder moves one step backward from its menu.
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move backward" }).click();
  await expect.poll(names).toEqual(["Beta", "New folder"]);

  // The arrangement is the account's: it is there after a reload.
  await page.reload();
  await expect.poll(names).toEqual(["Beta", "New folder"]);

  // Restoring asks first; the confirmation brings the server's order back.
  // The grid's empty space: the area under the tiles.
  const space = grid.locator("xpath=..");
  const spaceBox = await space.boundingBox();
  await space.click({ button: "right", position: { x: 4, y: spaceBox.height - 4 } });
  await page.getByRole("menuitem", { name: "Restore default order" }).click();
  await expect(page.getByText(/your order and folders are cleared/)).toBeVisible();
  await page.getByRole("button", { name: "Restore default", exact: true }).click();
  await expect.poll(names).toEqual(APPS);

  // A tile opens windowed: the app's page is in the window over the grid.
  await tile("Beta").click();
  await expect(
    page.getByRole("region", { name: "Beta" }).frameLocator("iframe").getByRole("heading", {
      name: "Beta",
    }),
  ).toBeVisible({ timeout: 30_000 });
});

test("the header's New folder makes a folder of the checked apps at the first one's place", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  await setAccountPrefs(page.request, { lang: "en" });
  await page.goto(`${BASE}/apps`);
  const grid = page.getByRole("list", { name: "App Center" });
  const names = () =>
    grid
      // The workbenches' tiles and folders: the system apps lead the grid untouched.
      .locator(':scope > li:not([data-app^="system_agent/"])')
      .evaluateAll((items) =>
        items.map((li) => li.querySelector(":scope > button > span:last-child")?.textContent ?? ""),
      );
  await expect.poll(names).toEqual(APPS);

  await page.getByRole("button", { name: "New folder", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  const create = dialog.getByRole("button", { name: "Create" });
  // The starting name is selected: typing replaces it.
  await page.keyboard.type("Pair");
  await expect(dialog.getByRole("textbox", { name: "Folder name" })).toHaveValue("Pair");
  await expect(create).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /^Gamma/ }).check();
  await dialog.getByRole("checkbox", { name: /^Beta/ }).check();
  await create.click();
  await expect.poll(names).toEqual(["Alpha", "Pair"]);

  // Kept with the account.
  await page.reload();
  await expect.poll(names).toEqual(["Alpha", "Pair"]);
});

for (const width of [1280, 375]) {
  test(`an App Center folder promotes its last app in place at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await provisionAndLogin(page.request, U, P);
    await setAccountPrefs(page.request, { lang: "en" });
    const projectId = (await (await page.request.get("/api/projects")).json()).projects[0]
      .projectId;
    const base = "/api/projects/" + projectId + "/app-center";
    const keys = APPS.map((name) => "default_agent/" + name.toLowerCase());
    const items = [{ type: "folder", id: "tasks", name: "Tasks", apps: keys }];
    await expect(
      await page.request.put(base + "/layout", { data: { layout: { v: 1, items } } }),
    ).toBeOK();
    await page.goto("/apps");
    const folder = page.locator('[data-folder="tasks"] > button').first();
    const tile = (id) => page.locator('li[data-app="' + id + '"] > button').first();
    await folder.click();
    await tile(keys[2]).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remove from folder", exact: true }).click();
    await expect(folder).toHaveAttribute("aria-label", /2 apps/);
    if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
    await tile(keys[1]).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remove from folder", exact: true }).click();
    await expect(folder).toHaveCount(0);
    await expect(tile(keys[0])).toBeVisible();
    await page.reload();
    await expect(tile(keys[0])).toBeVisible();
    const retained = (await (await page.request.get(base)).json()).layout;
    expect(retained.items.slice(0, 3)).toEqual(keys.map((app) => ({ type: "app", app })));
    await tile(keys[0]).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to…", exact: true }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveCount(2);
    expect(await menu.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await menu.getByRole("menuitem", { name: "New folder…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New folder" });
    await expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
    await dialog.getByRole("checkbox", { name: /Beta/ }).check();
    await expect(dialog.getByRole("button", { name: "Create" })).toBeEnabled();
  });
}

test("disabling an app keeps its folder until the app is uninstalled", async ({ page }) => {
  await provisionAndLogin(page.request, "folderavailability", P);
  await setAccountPrefs(page.request, { lang: "en" });
  const { projects } = await (await page.request.get("/api/projects")).json();
  const base = "/api/projects/" + projects[0].projectId;
  const workbenches = base + "/agents/default_agent/workbenches";
  await importApp(page.request, workbenches, "Reader");
  await importApp(page.request, workbenches, "Planner");
  const apps = ["default_agent/reader", "default_agent/planner"];
  const layout = { v: 1, items: [{ type: "folder", id: "desk", name: "Desk", apps }] };
  await expect(await page.request.put(base + "/app-center/layout", { data: { layout } })).toBeOK();
  await expect(
    await page.request.put(workbenches + "/planner/enabled", { data: { enabled: false } }),
  ).toBeOK();
  await page.goto("/apps");
  const folder = page.locator('[data-folder="desk"] > button').first();
  await folder.click();
  await expect(page.locator('li[data-app="default_agent/reader"]')).toBeVisible();
  await expect(page.locator('li[data-app="default_agent/planner"]')).toHaveCount(0);
  const readLayout = async () =>
    (await (await page.request.get(base + "/app-center")).json()).layout;
  expect(await readLayout()).toEqual(layout);
  await expect(
    await page.request.put(workbenches + "/planner/enabled", { data: { enabled: true } }),
  ).toBeOK();
  await page.reload();
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
  await expect(page.locator('li[data-app="default_agent/planner"]')).toBeVisible();
  await expect(await page.request.delete(workbenches + "/planner")).toBeOK();
  await page.reload();
  await expect(folder).toHaveCount(0);
  await expect(page.locator('li[data-app="default_agent/reader"]')).toBeVisible();
  await expect.poll(readLayout).toEqual({ v: 1, items: [{ type: "app", app: apps[0] }] });
});

test("a system app's tile opens its page, where the App Center stays lit", async ({ page }) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  await page.goto(`${BASE}/apps`);
  const grid = page.getByRole("list", { name: "App Center" });
  await grid.getByRole("button", { name: "Self-Evolution Workbench, system app" }).click();
  await expect(page).toHaveURL(`${BASE}/benchmark`);
  const appCenter = page.locator("aside").first().getByRole("link", { name: "App Center" });
  await expect(appCenter).toHaveAttribute("aria-current", "page");
  // A Benchmark's own page lies under the Evaluation Center's.
  await page.goto(`${BASE}/benchmark/no-such-benchmark`);
  await expect(appCenter).toHaveAttribute("aria-current", "page");
});

test("searching, sorting and folding sidebar directories keeps the open page and its draft", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "sidebarsearch", P);
  await setAccountPrefs(page.request, { lang: "en" });
  const { projects } = await (await page.request.get("/api/projects")).json();
  const base = `/api/projects/${projects[0].projectId}/agents/default_agent/workbenches`;
  for (const title of ["Gamma", "Alpha"]) await importApp(page.request, base, title);
  const model = { provider: "custom", modelId: "sidebar-test" };
  const configured = await page.request.put(`/api/projects/${projects[0].projectId}/models`, {
    data: {
      defaultModel: model,
      models: [
        { ...model, apiKey: "sk-mock", baseUrl: process.env.MOCK_URL, contextWindow: 200000 },
      ],
    },
  });
  expect(configured.ok(), await configured.text()).toBeTruthy();
  await page.goto("/chat/new");
  const side = page.getByRole("complementary");
  const apps = side.getByRole("list", { name: "Apps", exact: true });
  const rows = apps.getByRole("listitem");
  await expect(rows).toHaveCount(0);
  const editor = page.getByRole("main").locator("textarea").first();
  await editor.fill("Keep this draft while looking for an app");
  const catalog = side.getByRole("link", { name: /^App Center(?: ·|$)/ });
  for (const title of ["Gamma", "Alpha"]) {
    await catalog.click();
    const tile = page
      .getByRole("list", { name: "App Center", exact: true })
      .locator(`li[data-app="default_agent/${title.toLowerCase()}"] > button`)
      .first();
    await tile.click();
    await expect(
      apps.locator(`[data-app-row="default_agent/${title.toLowerCase()}"]`),
    ).toBeVisible();
  }
  const newChat = side.getByRole("button", { name: "New chat", exact: true });
  await newChat.click();
  await expect(rows).toHaveCount(2);
  const count = await rows.count();
  await side.getByRole("button", { name: "Search apps", exact: true }).click();
  const query = side.getByRole("searchbox", { name: "Search apps" });
  await query.fill("gamma");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(/gamma/i);
  await query.fill("no such workspace application");
  await expect(side.getByText("No matching apps")).toBeVisible();
  await query.press("Escape");
  await expect(query).toHaveCount(0);
  await side.getByRole("button", { name: "Sort apps", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Name", exact: true }).click();
  const names = await rows.locator("button[data-app-row] > .truncate").allTextContents();
  expect(names.length).toBeGreaterThan(1);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

  await side.getByRole("button", { name: "Sort apps", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Recently used" }).click();
  await expect(rows.first()).toContainText("Alpha");
  await apps.locator('[data-app-row="default_agent/gamma"]').click();
  await expect(rows.first()).toContainText("Gamma");
  await expect(rows.last()).toContainText("Alpha");
  await newChat.click();

  const foldApps = side.getByRole("button", { name: "Apps", exact: true });
  const foldWorkspaces = side.getByRole("button", { name: "Workspaces", exact: true });
  await foldApps.click();
  await expect(foldWorkspaces).toHaveAttribute("aria-expanded", "true");
  await foldWorkspaces.click();
  await foldApps.click();
  await expect(foldWorkspaces).toHaveAttribute("aria-expanded", "false");
  await expect(rows.first()).toBeVisible();
  await expect(rows).toHaveCount(count);
  await expect(editor).toHaveValue("Keep this draft while looking for an app");
  await expect(page).toHaveURL(/\/chat\/new$/);
});

test("many open apps scroll inside Apps while the workspace and directory search remain reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await provisionAndLogin(page.request, "sidebarlonglist", P);
  await setAccountPrefs(page.request, { lang: "en" });
  const { projects } = await (await page.request.get("/api/projects")).json();
  const base = `/api/projects/${projects[0].projectId}/agents/default_agent/workbenches`;
  const titles = Array.from(
    { length: 30 },
    (_, index) => "Notebook-" + String(index + 1).padStart(2, "0"),
  );
  for (const title of titles) await importApp(page.request, base, title);
  const catalog = `/api/projects/${projects[0].projectId}/app-center`;
  await page.goto("/apps");
  const notebook = page.locator('li[data-app="default_agent/notebook-01"] > button').first();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await notebook.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to…" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveCount(2);
    expect(await menu.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const group = page.getByRole("navigation", { name: "Apps", exact: true });
  const list = group.getByRole("list", { name: "Apps", exact: true });
  await expect(list).toHaveCount(0);
  for (const title of titles) {
    await page
      .getByRole("complementary")
      .getByRole("link", { name: /^App Center(?: ·|$)/ })
      .click();
    await page
      .getByRole("list", { name: "App Center", exact: true })
      .locator(`li[data-app="default_agent/${title.toLowerCase()}"] > button`)
      .first()
      .click();
    const row = list.locator(`[data-app-row="default_agent/${title.toLowerCase()}"]`);
    await expect(row).toBeEnabled();
    await expect(row).toHaveAttribute("aria-current", "page");
  }
  const count = await list.getByRole("listitem").count();
  expect(count).toBeGreaterThanOrEqual(30);
  const bounds = () =>
    list.evaluate((el) => ({
      height: el.clientHeight,
      content: el.scrollHeight,
      offset: el.scrollTop,
    }));
  const desktop = await bounds();
  expect(desktop.content).toBeGreaterThan(desktop.height * 3);
  expect(desktop.offset).toBeGreaterThan(0);
  const workspaces = page.getByRole("button", { name: "Workspaces", exact: true });
  await expect(workspaces).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 700 });
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^Sessions/ })
    .click();
  expect((await bounds()).height).toBeLessThan(desktop.height);
  // In a short drawer, reaching the next group takes at most a few rows of outer scrolling,
  // regardless of how many apps are running. The rest of the app list scrolls independently.
  const gap = await workspaces.evaluate((button) => {
    const scroll = button.closest(".overflow-y-auto");
    const distance = Math.max(
      0,
      button.getBoundingClientRect().bottom - scroll.getBoundingClientRect().bottom,
    );
    const row = document.querySelectorAll('nav[aria-label="Apps"] li > div');
    const height = [...row].find((node) => node.clientHeight > 0).clientHeight;
    scroll.scrollBy(0, distance + 1);
    return distance / height;
  });
  expect(gap).toBeLessThanOrEqual(3);
  await expect(workspaces).toBeInViewport();
  const kept = {
    v: 1,
    items: [
      {
        type: "folder",
        id: "notes",
        name: "Notebooks",
        apps: ["default_agent/notebook-01", "default_agent/notebook-02"],
      },
    ],
  };
  await expect(await page.request.put(catalog + "/layout", { data: { layout: kept } })).toBeOK();
  await group.getByRole("button", { name: "Search apps" }).click();
  const search = group.getByRole("searchbox", { name: "Search apps" });
  await search.fill("Notebook-01");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("button", { name: /Notebook-01/ })).toBeVisible();
  expect((await (await page.request.get(catalog)).json()).layout).toEqual(kept);
  await expect(page).toHaveURL(/notebook-30/);
  await search.press("Escape");
  await expect(list.getByRole("listitem")).toHaveCount(count);
});

test("a multi-page workbench keeps its own selector above the active document", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "atlasreader", P);
  await setAccountPrefs(page.request, { lang: "en" });
  const { projects } = await (await page.request.get("/api/projects")).json();
  const definition = manifest("Atlas");
  definition.penguin.modules[0].contributes["WebModule.sessionTabs"].push({
    id: "atlas.map",
    key: "map",
    title: "Map",
    renderer: { iframe: { src: "ui/map.html" } },
  });
  const archive = zip({
    "atlas/package.json": JSON.stringify(definition),
    "atlas/index.ts": INDEX,
    "atlas/ui/index.html": "<h1>Field notes</h1>",
    "atlas/ui/map.html": "<h1>Relief map</h1>",
  });
  await expect(
    await page.request.post(
      `/api/projects/${projects[0].projectId}/agents/default_agent/workbenches/archive`,
      {
        data: { dataBase64: archive.toString("base64") },
      },
    ),
  ).toBeOK();
  await page.goto("/apps");
  await page
    .getByRole("list", { name: "App Center" })
    .getByRole("button", { name: /^Atlas/ })
    .click();
  const app = page.getByRole("region", { name: "Atlas" });
  const frame = app.frameLocator("iframe");
  await expect(frame.getByRole("heading", { name: "Field notes" })).toBeVisible();
  const map = app.getByRole("button", { name: "Map", exact: true });
  await map.focus();
  await page.keyboard.press("Enter");
  await expect(map).toHaveAttribute("aria-pressed", "true");
  await expect(frame.getByRole("heading", { name: "Relief map" })).toBeVisible();
  const control = await map.boundingBox();
  const document = await app.locator("iframe").boundingBox();
  expect(control.y + control.height).toBeLessThanOrEqual(document.y + 1);
  await expect(app.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
});

test("only open workbenches appear across the App Center, Session directory and Project changes", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await provisionAndLogin(page.request, "directoryreader", P);
  await setAccountPrefs(page.request, { lang: "en" });
  const { projects } = await (await page.request.get("/api/projects")).json();
  const current = projects[0];
  const base = `/api/projects/${current.projectId}`;
  const projectName = "Cabinet collection";
  await expect(await page.request.patch(base, { data: { name: projectName } })).toBeOK();
  const alternate = "other_reader";
  const otherProject = "directoryreader-empty";
  await expect(
    await page.request.post(`${base}/agents`, {
      data: { agentId: alternate, name: "Second reader" },
    }),
  ).toBeOK();
  await expect(
    await page.request.post("/api/projects", {
      data: { projectId: otherProject, name: "Empty scope" },
    }),
  ).toBeOK();
  const model = { provider: "custom", modelId: "claude-4-8" };
  for (const projectId of [current.projectId, otherProject]) {
    await expect(
      await page.request.put(`/api/projects/${projectId}/models`, {
        data: {
          defaultModel: model,
          models: [
            { ...model, apiKey: "sk-mock", baseUrl: process.env.MOCK_URL, contextWindow: 200000 },
          ],
        },
      }),
    ).toBeOK();
  }
  for (let index = 1; index <= 30; index++) {
    await importApp(
      page.request,
      `${base}/agents/default_agent/workbenches`,
      `Cabinet${String(index).padStart(2, "0")}`,
    );
  }
  await importApp(page.request, `${base}/agents/${alternate}/workbenches`, "UnopenedAtlas");
  for (const [agent, title] of [
    ["default_agent", "Directory inspection"],
    [alternate, "Other reader notes"],
  ]) {
    const response = await page.request.post(`${base}/agents/${agent}/sessions`, { data: {} });
    await expect(response).toBeOK();
    const { session } = await response.json();
    await expect(
      await page.request.patch(`/api/sessions/${session.sessionId}`, { data: { title } }),
    ).toBeOK();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps");
  const grid = page.getByRole("list", { name: "App Center" });
  const group = page.getByRole("navigation", { name: "Apps", exact: true });
  const rows = group.getByRole("listitem");
  const row = (id) => group.locator(`[data-app-row="default_agent/${id}"]`);
  async function actOnLastApp(label) {
    const item = rows.filter({ has: page.locator('[data-app-row="default_agent/cabinet30"]') });
    await item.hover();
    await item.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
  }
  await expect(grid.getByRole("button", { name: /^Cabinet/ })).toHaveCount(30);
  await expect(group).toHaveCount(0);
  await grid.getByRole("button", { name: /^Cabinet01,/ }).click();
  await expect(row("cabinet01")).toBeVisible();
  await expect(rows).toHaveCount(1);

  await page.getByText("Directory inspection", { exact: true }).first().click();
  await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await page.getByRole("button", { name: "Open App Center", exact: true }).click();
  const directory = page.getByRole("list", { name: "App Center", exact: true });
  const secondApp = directory.locator('li[data-app="default_agent/cabinet30"] > button').first();
  await expect(secondApp).toBeVisible();
  await expect(rows).toHaveCount(1);
  await secondApp.click();
  await expect(row("cabinet30")).toBeVisible();
  await expect(rows).toHaveCount(2);
  await actOnLastApp("Minimize");
  await expect(rows).toHaveCount(2);
  await actOnLastApp("Restore");
  await actOnLastApp("Close");
  await expect(rows).toHaveCount(1);
  await expect(row("cabinet01")).toBeVisible();

  await page.getByText("Other reader notes", { exact: true }).first().click();
  await expect(rows).toHaveCount(1);
  await expect(group.getByText("UnopenedAtlas", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: projectName, exact: true }).click();
  await page
    .getByRole("button", { name: /^Empty scope/ })
    .first()
    .click();
  const emptyProject = page.getByRole("button", { name: "Empty scope", exact: true });
  await expect(emptyProject).toBeVisible();
  await expect(group).toHaveCount(0);
  await emptyProject.click();
  await page
    .getByRole("button", { name: /^Cabinet collection/ })
    .first()
    .click();
  await page.getByRole("link", { name: /^App Center(?: ·|$)/ }).click();
  await expect(grid.getByRole("button", { name: /^Cabinet/ })).toHaveCount(30);
  await expect(group).toHaveCount(0);
});

test("duplicate workbenches show their Agent on desktop, in a folder, and on a phone", async ({
  page,
}) => {
  const { request } = page;
  const account = "tileowner";
  await provisionAndLogin(request, account, P);
  await setAccountPrefs(request, { lang: "en" });
  const { projects } = await (await request.get("/api/projects")).json();
  const base = `/api/projects/${projects[0].projectId}`;
  for (const [agentId, name, id] of [
    ["library_a", "Amber", "first-copy"],
    ["library_b", "Blue", "second-copy"],
  ]) {
    await expect(await request.post(base + "/agents", { data: { agentId, name } })).toBeOK();
    await importApp(request, base + "/agents/" + agentId + "/workbenches", "Notebook", id);
  }
  await importApp(request, base + "/agents/library_a/workbenches", "Calendar");
  const image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  await expect(
    await request.put(base + "/agents/library_b/avatar", { data: { avatar: image } }),
  ).toBeOK();
  const tiles = [
    ["library_a/first-copy", "Amber"],
    ["library_b/second-copy", "Blue"],
  ];
  const tile = (id) => page.locator(`[data-app="${id}"]`);
  for (const [width, height] of [
    [1280, 800],
    [375, 750],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(BASE + "/apps");
    await expect(tile("library_a/calendar").locator("[data-workbench-owner]")).toHaveCount(0);
    for (const [id, name] of tiles) {
      await expect(tile(id).getByRole("button")).toHaveAccessibleName(new RegExp(name));
      const badge = tile(id).locator("[data-workbench-owner]");
      if (name === "Blue") {
        const picture = badge.locator("img");
        await expect(picture).toHaveAttribute("src", /\/agents\/library_b\/avatar\?rev=/);
        await expect.poll(() => picture.evaluate((img) => img.naturalWidth)).toBe(1);
      } else {
        await expect(badge.locator("svg [data-variant]").first()).toBeAttached();
        await expect(badge).toHaveText("");
      }
      await tile(id).getByRole("button").click();
      await expect(page.locator(`[data-workspace-page="app:${id}"]`)).toBeVisible();
      await page.goto(BASE + "/apps");
    }
  }
  await expect(
    await request.put(base + "/app-center/layout", {
      data: {
        layout: {
          v: 1,
          items: [{ type: "folder", id: "shelf", name: "Shelf", apps: tiles.map(([id]) => id) }],
        },
      },
    }),
  ).toBeOK();
  await page.reload();
  const folder = page.locator('[data-folder="shelf"]');
  await expect(folder.locator("[data-workbench-owner]")).toHaveCount(2);
  await folder.getByRole("button").click();
  await expect(tile(tiles[0][0]).locator("[data-workbench-owner]")).toBeVisible();
});
