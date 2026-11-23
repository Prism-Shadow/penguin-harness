/**
 * - Opening many conversations leaves one Workspace row each; a native app opened twice
 *   has one Apps row, can share a pane with a conversation and is reachable on a phone.
 * - A native app can fill the screen while retaining its split and the other pane’s draft.
 * - The touch drawer offers More, Full screen and Close on each running app.
 * - Minimizing a workbench keeps its document; closing it destroys that document and
 *   keeps the conversation and its unfinished message available.
 */
import { expect, test } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const apps = (page) => page.getByRole("navigation", { name: "Apps", exact: true });
const slot = (page, id) => page.locator(`[data-workspace-page="${id}"]`);
const composer = '[data-slot="composer"] textarea';

async function fromRow(page, target, action) {
  await target.hover();
  await target
    .locator("xpath=ancestor::li[1]")
    .getByRole("button", { name: "More actions", exact: true })
    .click();
  const role = (await target.getAttribute("data-session-id")) !== null ? "button" : "menuitem";
  await page.getByRole(role, { name: action, exact: true }).click();
}

async function addSession(request, project, title, agent = "default_agent") {
  const response = await request.post(`${project}/agents/${agent}/sessions`, { data: {} });
  await expect(response).toBeOK();
  const { session } = await response.json();
  await expect(
    await request.patch("/api/sessions/" + session.sessionId, { data: { title } }),
  ).toBeOK();
  return { title, id: session.sessionId, key: "chat:" + session.sessionId };
}

async function setup(page, account) {
  if (account === ADMIN_ID) await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  else await provisionAndLogin(page.request, account, "password123");
  await setAccountPrefs(page.request, { lang: "en" });
  const { projects } = await (await page.request.get("/api/projects")).json();
  const project = "/api/projects/" + projects[0].projectId;
  const model = {
    provider: "custom",
    modelId: "claude-4-8",
    baseUrl: process.env.MOCK_URL,
    apiKey: "sk-mock",
    contextWindow: 200000,
  };
  await expect(
    await page.request.put(project + "/models", {
      data: {
        defaultModel: { provider: model.provider, modelId: model.modelId },
        models: [model],
      },
    }),
  ).toBeOK();
  return project;
}

test("many visited conversations and repeated launches use only their own sidebar groups", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const project = await setup(page, "openpagescollection");
  const sessions = [];
  for (let n = 1; n <= 30; n++) {
    sessions.push(
      await addSession(page.request, project, "Release batch " + String(n).padStart(2, "0")),
    );
  }
  const first = sessions[0],
    last = sessions.at(-1);
  await page.goto("/chat/" + first.id);
  await slot(page, first.key).locator(composer).fill("A draft from the first page");
  const moreChats = page.getByRole("button", { name: /^Show \d+ more chats?$/ });
  await moreChats.first().click();
  await moreChats.first().click();
  await expect(page.locator("button[data-session-id]")).toHaveCount(sessions.length);
  for (const session of sessions.slice(1)) {
    await page.locator(`button[data-session-id="${session.id}"]`).click();
    await expect(slot(page, session.key)).toBeVisible();
  }
  const side = page.getByRole("complementary");
  const appCenter = side.getByRole("link", { name: /^App Center(?: ·|$)/ });
  const models = apps(page).locator('[data-app-row="system_agent/models"]');
  for (let open = 0; open < 2; open++) {
    await appCenter.click();
    await page
      .getByRole("list", { name: "App Center" })
      .locator('[data-app="system_agent/models"] > button')
      .first()
      .click();
    await expect(page).toHaveURL(/\/models(?:\?|$)/);
    await expect(models).toHaveCount(1);
  }
  await expect(side.getByRole("navigation", { name: "Open pages", exact: true })).toHaveCount(0);
  await expect(apps(page).getByRole("listitem")).toHaveCount(1);
  const workspace = (id) => page.locator(`button[data-session-id="${id}"]:visible`);
  await expect(side.locator("button[data-session-id]")).toHaveCount(sessions.length);
  await fromRow(page, workspace(first.id), "Open on the left");
  await expect(slot(page, first.key)).toHaveAttribute("data-pane", "left");
  await expect(slot(page, "app:system_agent/models")).toHaveAttribute("data-pane", "right");
  await expect(slot(page, first.key).locator(composer)).toHaveValue("A draft from the first page");
  const nativeRow = models.locator("xpath=ancestor::li[1]");
  await nativeRow.getByRole("button", { name: "Open full screen", exact: true }).click();
  await expect(slot(page, "app:system_agent/models")).toHaveAttribute("data-pane", "full");
  await expect(side).not.toBeVisible();
  await expect(slot(page, first.key)).not.toBeVisible();
  await page.getByRole("button", { name: "Exit full screen", exact: true }).click();
  await expect(side).toBeVisible();
  await expect(slot(page, "app:system_agent/models")).toHaveAttribute("data-pane", "right");
  await expect(slot(page, first.key)).toHaveAttribute("data-pane", "left");
  await slot(page, first.key).locator(composer).click();
  await expect(slot(page, first.key).locator(composer)).toHaveValue("A draft from the first page");
  await page.setViewportSize({ width: 390, height: 844 });
  const drawer = page.getByRole("banner").getByRole("button", { name: /^Sessions/ });
  await expect(slot(page, first.key)).toBeVisible();
  await expect(
    slot(page, first.key).locator('[data-testid="dock"][data-position="bottom"]'),
  ).toBeVisible();
  await expect(slot(page, "app:system_agent/models")).toBeVisible();
  await drawer.click();
  await models.click();
  await expect(slot(page, "app:system_agent/models")).toBeVisible();
  await drawer.click();
  await workspace(last.id).click();
  await expect(slot(page, last.key)).toBeVisible();
  await expect(slot(page, "app:system_agent/models")).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("sidebar minimize restores the same workbench and close ends its frame", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const project = await setup(page, ADMIN_ID);
  const notes = await addSession(page.request, project, "Support triage", "penguin_support");
  await page.goto("/chat/" + notes.id);
  const chat = slot(page, notes.key);
  await chat.locator(composer).fill("Keep this triage note");
  await chat.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await chat.getByRole("button", { name: "Open App Center", exact: true }).click();
  await page
    .getByRole("list", { name: "App Center", exact: true })
    .locator('li[data-app="penguin_support/support"] > button')
    .first()
    .click();
  const appKey = "app:penguin_support/support";
  const app = slot(page, appKey);
  await expect(app).toHaveAttribute("data-pane", "right");
  const iframe = app.locator("iframe").first();
  await expect(iframe).toBeVisible();
  const node = await iframe.elementHandle();
  const original = await node.contentFrame();
  await original.evaluate(() => {
    window.openPagesRegression = "live workbench";
  });
  await expect(app.getByRole("button", { name: "Minimize", exact: true })).toHaveCount(0);
  await expect(app.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  const target = apps(page).locator('[data-app-row="penguin_support/support"]');
  await fromRow(page, target, "Minimize");
  await expect(iframe).not.toBeVisible();
  await expect(chat.locator(composer)).toHaveValue("Keep this triage note");
  await fromRow(page, target, "Restore");
  await expect(iframe).toBeVisible();
  expect(await original.evaluate(() => window.openPagesRegression)).toBe("live workbench");
  await fromRow(page, target, "Close");
  await expect(slot(page, appKey)).toHaveCount(0);
  expect(original.isDetached()).toBe(true);
  await expect(page.locator(`button[data-session-id="${notes.id}"]`)).toHaveCount(1);
  await expect(chat.locator(composer)).toHaveValue("Keep this triage note");
  await chat.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await chat.getByRole("button", { name: "Open App Center", exact: true }).click();
  await page
    .getByRole("list", { name: "App Center", exact: true })
    .locator('li[data-app="penguin_support/support"] > button')
    .first()
    .click();
  await fromRow(page, target, "Open full screen");
  const fullPath = /\/app\/default_project\/penguin_support\/support(?:\/support)?$/;
  await expect(page).toHaveURL(fullPath);
  await page.getByRole("button", { name: "Exit full screen" }).click();
  await expect(page).not.toHaveURL(fullPath);
  await page.goto("/app/default_project/penguin_support/support");
  await expect(page.locator("iframe:visible").first()).toBeVisible();
  await page.getByRole("button", { name: "Exit full screen" }).click();
  await expect(page).toHaveURL(/\/apps\?app=penguin_support%2Fsupport$/);
  await expect(page.getByRole("region", { name: "Support" }).locator("iframe")).toBeVisible();
});

test.describe("touch app controls", () => {
  test.use({ hasTouch: true, viewport: { width: 360, height: 780 } });
  test("uses each window button in the phone drawer without opening the underlying row", async ({
    page,
  }) => {
    await setup(page, "touchappcontrols");
    await page.goto("/apps");
    const models = "system_agent/models";
    await page.locator(`[data-app="${models}"] > button`).first().tap();
    const drawer = page.getByRole("banner").getByRole("button", { name: /^Sessions/ });
    await drawer.tap();
    const row = apps(page)
      .getByRole("listitem")
      .filter({ has: page.locator(`[data-app-row="${models}"]`) });
    const more = row.getByRole("button", { name: "More actions", exact: true });
    const full = row.getByRole("button", { name: "Open full screen", exact: true });
    const close = row.getByRole("button", { name: "Close", exact: true });
    await more.tap({ trial: true });
    let right = 0;
    for (const control of [more, full, close]) {
      const box = await control.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
      expect(box.x).toBeGreaterThanOrEqual(right);
      right = box.x + box.width;
    }
    await more.tap();
    await page.getByRole("menuitem", { name: "Minimize", exact: true }).tap();
    await drawer.tap();
    await full.tap();
    await expect(slot(page, "app:" + models)).toHaveAttribute("data-pane", "full");
    await page.getByRole("button", { name: "Exit full screen", exact: true }).tap();
    await drawer.tap();
    await close.tap();
    await drawer.tap();
    await expect(row).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
  });
});
