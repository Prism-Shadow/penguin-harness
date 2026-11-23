// The compact sidebar is exercised through real Session links and App Center entries.
import { expect, test } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const sidebarPages = (page) => page.getByRole("navigation", { name: "Open pages", exact: true });
const allPages = (page) => page.getByRole("dialog", { name: "All open pages", exact: true });
const pageButton = (area, id) => area.locator(`[data-app-row="${id}"]`);
const slot = (page, id) => page.locator(`[data-workspace-page="${id}"]`);
const composer = '[data-slot="composer"] textarea';

async function fromRow(page, area, id, action) {
  const row = area.getByRole("listitem").filter({ has: pageButton(page, id) });
  await row.hover();
  await row.getByRole("button", { name: /^Page actions/ }).click();
  await page.getByRole("menu").getByText(action, { exact: true }).click();
}

async function openManager(page) {
  await sidebarPages(page)
    .getByRole("button", { name: /^All open pages/ })
    .click();
  return allPages(page);
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

test("many open sessions and apps stay reachable while the sidebar keeps both visible panes", async ({
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
  await page
    .getByRole("link", { name: /^App Center(?: ·|$)/ })
    .or(page.getByRole("button", { name: /^App Center(?: ·|$)/ }))
    .first()
    .click();
  const catalog = page.getByRole("list", { name: "App Center" });
  await catalog.getByRole("button", { name: /^Models(?:,|$)|^Model library(?:,|$)/i }).click();
  await expect(page).toHaveURL(/\/models(?:\?|$)/);

  const compact = sidebarPages(page);
  await expect(compact.locator("button[data-app-row]:visible")).toHaveCount(6);
  let manager = await openManager(page);
  for (const session of sessions) await expect(pageButton(manager, session.key)).toHaveCount(1);
  const filter = manager.getByPlaceholder("Search open pages");
  await filter.press("Control+ArrowDown");
  await expect(filter).toBeFocused();
  await filter.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(manager).toBeVisible();
  await filter.fill(first.title);
  await expect(pageButton(manager, first.key)).toBeVisible();
  await expect(pageButton(manager, last.key)).toHaveCount(0);
  await filter.press("Escape");
  await expect(filter).toHaveValue("");
  await filter.press("Escape");
  await expect(manager).toBeHidden();
  await expect(page).toHaveURL(/\/models(?:\?|$)/);
  manager = await openManager(page);
  await fromRow(page, manager, first.key, "Open on the right");
  await expect(slot(page, first.key)).toHaveAttribute("data-pane", "right");
  await expect(slot(page, first.key).locator(composer)).toHaveValue("A draft from the first page");
  await expect(compact.locator("button[data-app-row]:visible")).toHaveCount(6);
  await expect(pageButton(compact, first.key)).toBeVisible();
  await expect(pageButton(compact, first.key)).toHaveAccessibleName(/Right pane/);
  await expect(pageButton(compact, "app:system_agent/models")).toHaveAccessibleName(/Left pane/);
  await compact.getByRole("button", { expanded: true }).first().click();
  await expect(pageButton(compact, first.key)).not.toBeVisible();
  manager = await openManager(page);
  await expect(pageButton(manager, last.key)).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(slot(page, first.key)).toBeVisible();
  await expect(slot(page, "app:system_agent/models")).not.toBeVisible();
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^Sessions/ })
    .click();
  manager = await openManager(page);
  await manager.getByPlaceholder("Search open pages").fill(last.title);
  await manager.getByPlaceholder("Search open pages").press("ArrowDown");
  await expect(pageButton(manager, last.key)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(slot(page, last.key)).toBeVisible();
  await expect(slot(page, first.key)).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("sidebar minimize restores the same workbench and close ends its frame", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const project = await setup(page, ADMIN_ID);
  const notes = await addSession(page.request, project, "Support triage", "penguin_support");
  await page.goto("/chat/" + notes.id);
  const chat = slot(page, notes.key);
  await chat.locator(composer).fill("Keep this triage note");
  await chat.getByRole("button", { name: "Browse workbenches" }).click();
  await page
    .getByRole("region", { name: "Workbenches" })
    .getByText("Support", { exact: true })
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
  const compact = sidebarPages(page);
  await fromRow(page, compact, appKey, "Minimize");
  await expect(iframe).not.toBeVisible();
  await expect(chat.locator(composer)).toHaveValue("Keep this triage note");
  await fromRow(page, compact, appKey, "Restore");
  await expect(iframe).toBeVisible();
  expect(await original.evaluate(() => window.openPagesRegression)).toBe("live workbench");
  await fromRow(page, compact, appKey, "Close");
  await expect(slot(page, appKey)).toHaveCount(0);
  expect(original.isDetached()).toBe(true);
  await expect(chat.locator(composer)).toHaveValue("Keep this triage note");
  await chat.getByRole("button", { name: "Browse workbenches" }).click();
  await page
    .getByRole("region", { name: "Workbenches" })
    .getByText("Support", { exact: true })
    .click();
  await fromRow(page, compact, appKey, "Open full screen");
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
