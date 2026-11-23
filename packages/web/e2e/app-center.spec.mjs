/**
 * End-to-end tests for the App Center (/apps), against the real server (locale en).
 *
 * - The admin's default Project lists the shipped Support workbench as a tile with its own icon,
 *   served by the icon route. A click opens it windowed over the grid; the window's minimize
 *   returns to the grid with the tile marked running, and the tile brings back the same frame;
 *   the window's close returns to the grid; "Open full screen" in the tile's menu opens the full
 *   page, whose exit comes back to the App Center. The App Center switch on the workbench's row (the Plugins
 *   tab's Workbenches sub-page) takes the tile off and puts
 *   it back.
 * - With three workbenches of a fresh account's Agent: a real pointer drag of one tile onto the
 *   middle of another rings the target while it hovers and makes a folder on release, which
 *   opens as a panel over the grid; the menu moves a tile backward; the arrangement outlives a
 *   reload; restoring the default order asks first and then clears it. After several pages of
 *   navigation inside a grouped app, its close button still returns directly to its tile.
 * - The header's New folder makes a folder of the apps checked in its dialog, under the name
 *   typed there, at the first checked app's place.
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

test("the App Center opens Support windowed and full screen, and its switch takes the tile off and back", async ({
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
  await page.getByRole("button", { name: "Page actions · Support", exact: true }).click();
  await page.getByRole("menuitem", { name: "Minimize", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/apps`);
  await expect(grid.getByRole("button", { name: /^Support, .+, Running$/ })).toBeVisible();
  await tile.click();
  await expect(appWindow.locator('iframe[data-e2e-kept="yes"]')).toBeVisible();
  await page.getByRole("button", { name: "Page actions · Support", exact: true }).click();
  await page.getByRole("menuitem", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/apps`);
  await expect(grid.getByRole("button", { name: /^Support, .+, Running$/ })).toHaveCount(0);

  await tile.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open full screen" }).click();
  await expect(page).toHaveURL(/\/app\/default_project\/penguin_support\/support$/);
  await page.getByRole("button", { name: "Exit full screen" }).click();
  await expect(page).toHaveURL(`${BASE}/apps`);

  await openSupportRow(page);
  const toggle = page.getByRole("switch", { name: "Show in the App Center Support" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  // The reload behind the switch compiles the workbench: the row reads back once it is done.
  await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
  await expect(toggle).toBeEnabled({ timeout: 30_000 });

  await page.goto(`${BASE}/apps`);
  await expect(grid).toBeVisible();
  await expect(tile).toHaveCount(0);
  const { shortcuts } = await (
    await page.request.get(`${BASE}/api/projects/default_project/app-center`)
  ).json();
  await expect(page.getByText("No apps from agents yet")).toBeVisible({
    visible: shortcuts.length === 0,
  });
  await expect(page.getByRole("button", { name: "Create with AI" })).toBeVisible();

  await openSupportRow(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await expect(toggle).toBeEnabled({ timeout: 30_000 });
  await page.goto(`${BASE}/apps`);
  await expect(grid.getByRole("button", { name: /^Support/ })).toBeVisible();
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
  for (const title of APPS) {
    const id = title.toLowerCase();
    const imported = await seed.request.post(`${base}/archive`, {
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
  await seed.close();
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
  await window.getByRole("button", { name: "Close", exact: true }).click();
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

test("a system app's tile opens its page, where the App Center stays lit", async ({ page }) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  await page.goto(`${BASE}/apps`);
  const grid = page.getByRole("list", { name: "App Center" });
  await grid.getByRole("button", { name: "Evaluation Center, system app" }).click();
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
  await provisionAndLogin(page.request, U, P);
  await setAccountPrefs(page.request, { lang: "en" });
  const { projects } = await (await page.request.get("/api/projects")).json();
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
  await expect.poll(() => rows.count()).toBeGreaterThan(1);
  const editor = page.getByRole("main").locator("textarea").first();
  await editor.fill("Keep this draft while looking for an app");
  const open = side.getByRole("navigation", { name: "Open pages" });
  const count = await open.getByRole("listitem").count();
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
  const foldApps = side.getByRole("button", { name: "Apps", exact: true });
  const foldWorkspaces = side.getByRole("button", { name: "Workspaces", exact: true });
  await foldApps.click();
  await expect(foldWorkspaces).toHaveAttribute("aria-expanded", "true");
  await foldWorkspaces.click();
  await foldApps.click();
  await expect(foldWorkspaces).toHaveAttribute("aria-expanded", "false");
  await expect(rows.first()).toBeVisible();
  await expect(open.getByRole("listitem")).toHaveCount(count);
  await expect(editor).toHaveValue("Keep this draft while looking for an app");
  await expect(page).toHaveURL(/\/chat\/new$/);
});
