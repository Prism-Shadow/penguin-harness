import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const composer = '[data-slot="composer"] textarea';
const openPages = (page) => page.getByRole("navigation", { name: "Open pages" });
const slot = (page, id) => page.locator(`[data-workspace-page="${id}"]`);
const tab = (page, id) =>
  openPages(page)
    .getByRole("listitem")
    .filter({ has: page.locator(`[data-app-row="${id}"]`) });

async function action(page, id, label) {
  const row = tab(page, id);
  await row.hover();
  await row.getByRole("button", { name: /^Page actions/ }).click();
  await page.getByRole("menu").getByText(label, { exact: true }).click();
}

async function start(page, user) {
  if (user === ADMIN_ID) await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  else await provisionAndLogin(page.request, user, "password123");
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
      data: { defaultModel: { provider: model.provider, modelId: model.modelId }, models: [model] },
    }),
  ).toBeOK();
  const ids = [];
  for (const [agent, title] of [
    [user === ADMIN_ID ? "penguin_support" : "default_agent", "Workspace notes"],
    ["default_agent", "Release checklist"],
  ]) {
    const created = await page.request.post(`${project}/agents/${agent}/sessions`, { data: {} });
    await expect(created).toBeOK();
    const { session } = await created.json();
    await expect(
      await page.request.patch("/api/sessions/" + session.sessionId, { data: { title } }),
    ).toBeOK();
    ids.push(session.sessionId);
  }
  await page.goto("/chat/" + ids[0]);
  return ids.map((id) => "chat:" + id);
}

test("two sessions keep their own drafts through split, swap and close", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const [first, second] = await start(page, "splitdrafts");
  const firstSlot = slot(page, first);
  const secondSlot = slot(page, second);
  await firstSlot.locator(composer).fill("First pane draft");
  await page.getByText("Release checklist", { exact: true }).first().click();
  await secondSlot.locator(composer).fill("Second pane draft");
  await action(page, first, "Open on the right");
  await expect(firstSlot).toHaveAttribute("data-pane", "right");
  await expect(secondSlot).toHaveAttribute("data-pane", "left");
  await expect(firstSlot.locator(composer)).toHaveValue("First pane draft");
  await expect(secondSlot.locator(composer)).toHaveValue("Second pane draft");
  await secondSlot.locator(composer).fill("Updated on left");
  await expect(firstSlot.locator(composer)).toHaveValue("First pane draft");
  await action(page, second, "Swap panes");
  await expect(secondSlot).toHaveAttribute("data-pane", "right");
  const left = await firstSlot.boundingBox(),
    right = await secondSlot.boundingBox();
  expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);
  await action(page, first, "Move down");
  await expect(openPages(page).locator("[data-app-row]").first()).toHaveAttribute(
    "data-app-row",
    second,
  );
  const fold = openPages(page).locator("button[aria-expanded]").first();
  await fold.click();
  await expect(tab(page, first)).not.toBeVisible();
  await fold.click();
  await action(page, first, "Close");
  await expect(tab(page, first)).toHaveCount(0);
  await expect(secondSlot).toHaveAttribute("data-pane", "full");
  await expect(secondSlot.locator(composer)).toHaveValue("Updated on left");
});

test("a workbench shares the session viewport and its iframe survives changing pages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const [id] = await start(page, ADMIN_ID);
  const chat = slot(page, id);
  await chat.locator(composer).fill("Keep the support conversation");
  await chat.getByRole("button", { name: "Browse workbenches" }).click();
  const directory = page.getByRole("region", { name: "Workbenches" });
  await expect(directory).toBeVisible();
  await directory.getByText("Support", { exact: true }).click();
  const app = slot(page, "app:penguin_support/support");
  await expect(chat).toHaveAttribute("data-pane", "left");
  await expect(app).toHaveAttribute("data-pane", "right");
  const frame = app.locator("iframe").first();
  await expect(frame).toBeVisible();
  const node = await frame.elementHandle();
  const original = await node.contentFrame();
  await original.evaluate(() => (window.workspaceContinuity = "initial frame"));
  await action(page, id, "Show full page");
  await expect(frame).not.toBeVisible();
  await action(page, "app:penguin_support/support", "Open on the right");
  await expect(frame).toBeVisible();
  expect(await original.evaluate(() => window.workspaceContinuity)).toBe("initial frame");
  await expect(chat.locator(composer)).toHaveValue("Keep the support conversation");
});

test("a phone chooses one of the two open pages", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const [first, second] = await start(page, "splitphone");
  await page.getByText("Release checklist", { exact: true }).first().click();
  await action(page, first, "Open on the right");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(slot(page, first)).toBeVisible();
  await expect(slot(page, second)).not.toBeVisible();
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^Sessions/ })
    .click();
  await tab(page, second).locator("[data-app-row]").click();
  await expect(slot(page, second)).toBeVisible();
  await expect(slot(page, first)).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
