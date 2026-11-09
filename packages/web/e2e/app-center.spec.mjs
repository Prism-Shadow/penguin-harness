/**
 * End-to-end tests for the App Center (/apps), against the real server (locale en).
 *
 * - The admin's default Project lists the shipped Support workbench as a tile with its own icon,
 *   served by the icon route. A click opens it windowed over the grid, and the window's close
 *   returns to the grid; "Open full screen" in the tile's menu opens the full page, whose exit
 *   comes back to the App Center. The Show in the App Center switch on the workbench's row
 *   takes the tile off (the empty page offers Create with AI) and puts it back.
 * - With three workbenches of a fresh account's Agent: dragging one tile onto another makes a
 *   folder, which opens as a panel over the grid; the menu moves a tile backward; the arrangement
 *   outlives a reload; restoring the default order asks first and then clears it.
 */
import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
import { zip } from "./workbench-zip.mjs";

const BASE = process.env.BASE_URL;
const SUPPORT = "/agents/penguin_support?tab=workbenches";

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
  await appWindow.getByRole("button", { name: "Close, back to the App Center" }).click();
  await expect(page).toHaveURL(`${BASE}/apps`);

  await tile.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open full screen" }).click();
  await expect(page).toHaveURL(/\/app\/default_project\/penguin_support\/support$/);
  await page.getByRole("button", { name: "Exit full screen" }).click();
  await expect(page).toHaveURL(`${BASE}/apps`);

  await page.goto(`${BASE}${SUPPORT}`);
  const toggle = page.getByRole("switch", { name: "Show in the App Center Support" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  // The reload behind the switch compiles the workbench: the row reads back once it is done.
  await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
  await expect(toggle).toBeEnabled({ timeout: 30_000 });

  await page.goto(`${BASE}/apps`);
  await expect(page.getByText("The App Center is empty")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create with AI" })).toBeVisible();

  await page.goto(`${BASE}${SUPPORT}`);
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
  const base = `${BASE}/api/projects/${projectId}/agents/default_agent/workbenches`;
  for (const title of APPS) {
    const id = title.toLowerCase();
    const imported = await seed.request.post(`${base}/archive`, {
      data: {
        overwrite: true,
        dataBase64: zip({
          [`${id}/package.json`]: JSON.stringify(manifest(title)),
          [`${id}/index.ts`]: INDEX,
          [`${id}/ui/index.html`]: `<!doctype html><html><body><h1>${title}</h1></body></html>`,
        }).toString("base64"),
      },
    });
    expect(imported.ok(), await imported.text()).toBeTruthy();
  }
  await seed.close();
});

test("tiles drag into a folder, step through the menu, keep their order, and restore after asking", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  await setAccountPrefs(page.request, { lang: "en" });
  await page.goto(`${BASE}/apps`);
  const grid = page.getByRole("list", { name: "App Center" });
  const tile = (name) => grid.getByRole("button", { name: new RegExp(`^${name},`) });
  const names = () =>
    grid.locator(":scope > li").evaluateAll((items) =>
      items.map((li) => li.querySelector(":scope > button > span:last-child")?.textContent ?? ""),
    );
  for (const name of APPS) {
    await expect(tile(name)).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
  }
  expect(await names()).toEqual(APPS);

  // Gamma dropped on the middle of Alpha: a folder of the two, in Alpha's place.
  const item = (id) => grid.locator(`li[data-app="default_agent/${id}"]`);
  const box = await item("alpha").boundingBox();
  await item("gamma").dragTo(item("alpha"), {
    targetPosition: { x: box.width / 2, y: box.height / 2 },
  });
  await expect.poll(names).toEqual(["New folder", "Beta"]);

  const folder = grid.getByRole("button", { name: /^New folder, folder, 2 apps/ });
  await folder.click();
  const panel = page.getByRole("dialog", { name: "New folder" });
  await expect(panel.getByRole("button", { name: /^Alpha,/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Gamma,/ })).toBeVisible();
  await page.keyboard.press("Escape");
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
