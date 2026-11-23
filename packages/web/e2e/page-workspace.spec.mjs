/**
 * - Two Workspace conversations keep their own text across split, swap and closing a view.
 * - A conversation and a running app share the screen; pane actions preserve the actual iframe.
 * - A phone selects the other conversation from the Workspace in its drawer.
 * - Returning to an unsent conversation restores its staged upload and text.
 * - Account settings and repeated New chat shortcuts leave a fresh sidebar empty; sending
 *   creates one real conversation in its Workspace.
 */
import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";
import { watchSocket } from "./api-socket.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const composer = '[data-slot="composer"] textarea';
const slot = (page, id) => page.locator(`[data-workspace-page="${id}"]`);
const sessionRow = (page, key) => page.locator(`button[data-session-id="${key.slice(5)}"]:visible`);
const apps = (page) => page.getByRole("navigation", { name: "Apps", exact: true });

async function action(page, key, label) {
  const target = key.startsWith("chat:")
    ? sessionRow(page, key)
    : apps(page).locator(`[data-app-row="${key.slice(4)}"]`);
  const row = target.locator("xpath=ancestor::li[1]");
  await target.hover();
  await row.getByRole("button", { name: "More actions", exact: true }).click();
  const role = key.startsWith("chat:") ? "button" : "menuitem";
  await page.getByRole(role, { name: label, exact: true }).click();
}

async function setup(page, user) {
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
  return project;
}

async function start(page, user) {
  const project = await setup(page, user);
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
  await firstSlot.locator(composer).waitFor({ state: "hidden" });
  await action(page, first, "Open on the right");
  await expect(firstSlot).toHaveAttribute("data-pane", "right");
  await expect(secondSlot).toHaveAttribute("data-pane", "left");
  await expect(firstSlot.locator(composer)).toHaveValue("First pane draft");
  await firstSlot.locator('input[type="file"]:not([accept])').setInputFiles({
    name: "workspace-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Keep this upload"),
  });
  await expect(firstSlot.getByText("workspace-notes.txt", { exact: true })).toBeVisible();
  await expect(secondSlot.locator(composer)).toHaveValue("Second pane draft");
  await secondSlot.locator(composer).fill("Updated on left");
  await expect(firstSlot.locator(composer)).toHaveValue("First pane draft");
  const leftHeader = page.getByRole("group", { name: "Left pane", exact: true });
  const rightHeader = page.getByRole("group", { name: "Right pane", exact: true });
  await expect(
    leftHeader.getByRole("button", { name: "Release checklist", exact: true }),
  ).toBeVisible();
  await expect(
    rightHeader.getByRole("button", { name: "Workspace notes", exact: true }),
  ).toBeVisible();
  await leftHeader.getByRole("button", { name: "Pane actions · Release checklist" }).click();
  await page.getByRole("menuitem", { name: "Swap panes", exact: true }).click();
  await expect(secondSlot).toHaveAttribute("data-pane", "right");
  const left = await firstSlot.boundingBox(),
    right = await secondSlot.boundingBox();
  expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);
  await action(page, first, "Close view");
  await expect(firstSlot).not.toBeVisible();
  await expect(sessionRow(page, first)).toHaveCount(1);
  await expect(secondSlot).toHaveAttribute("data-pane", "full");
  await expect(secondSlot.locator(composer)).toHaveValue("Updated on left");
  await sessionRow(page, first).click();
  await expect(firstSlot.locator(composer)).toHaveValue("First pane draft");
  await expect(firstSlot.getByText("workspace-notes.txt", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("group", { name: "Left pane", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Right pane", exact: true })).toHaveCount(0);
  const dockTab = page.getByRole("tab", { name: /Support/ });
  await expect(dockTab).toBeVisible();
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
  await sessionRow(page, second).click();
  await expect(slot(page, second)).toBeVisible();
  await expect(slot(page, first)).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("resuming an unsent new conversation keeps its staged file", async ({ page }) => {
  const [existing] = await start(page, "splitnewdraft");
  await page
    .getByRole("link", { name: "New chat", exact: true })
    .or(page.getByRole("button", { name: "New chat", exact: true }))
    .first()
    .click();
  const draft = slot(page, "chat:new");
  await draft.locator(composer).fill("Review the attached agenda");
  await draft.locator('input[type="file"]:not([accept])').setInputFiles({
    name: "agenda.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Release meeting"),
  });
  await expect(draft.getByText("agenda.txt", { exact: true })).toBeVisible();
  await sessionRow(page, existing).click();
  await expect(slot(page, existing)).toBeVisible();
  await page.goBack();
  await expect(draft.locator(composer)).toHaveValue("Review the attached agenda");
  await expect(draft.getByText("agenda.txt", { exact: true })).toBeVisible();
  const side = page.getByRole("complementary");
  await side.getByRole("link", { name: /^App Center(?: ·|$)/ }).click();
  await page
    .getByRole("list", { name: "App Center" })
    .locator('[data-app="system_agent/models"] > button')
    .first()
    .click();
  await expect(page).toHaveURL(/\/models(?:\?|$)/);
  await side.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(draft.locator(composer)).toHaveValue("Review the attached agenda");
  await expect(draft.getByText("agenda.txt", { exact: true })).toBeVisible();
});

test("a fresh sidebar gains its first conversation only after sending", async ({ page }) => {
  const user = "sidebarnewconversation";
  await setup(page, user);
  await page.goto("/chat/new");
  const draft = slot(page, "chat:new");
  await expect(draft.locator(composer)).toBeVisible();
  const side = page.getByRole("complementary");
  const generic = side.getByRole("navigation", { name: "Open pages", exact: true });
  const sessions = side.locator("button[data-session-id]");
  await expect(generic).toHaveCount(0);
  await expect(apps(page)).toHaveCount(0);
  await expect(sessions).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Alt+n");
  await page.keyboard.press("ControlOrMeta+Alt+n");
  await side
    .getByRole("button", { name: new RegExp("^" + user) })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect(apps(page)).toHaveCount(0);
  await expect(sessions).toHaveCount(0);
  await draft.locator(composer).fill("Record this navigation check");
  await draft.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/session-/);
  await expect(sessions).toHaveCount(1);
  await expect(sessions).toHaveAttribute(
    "data-session-id",
    new URL(page.url()).pathname.split("/").at(-1),
  );
  await expect(generic).toHaveCount(0);
  await expect(apps(page)).toHaveCount(0);
});

test("an archived Session’s native app deep link uses its own dock and leaves its archive state intact", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 820 });
  const [key] = await start(page, "archivedappdock");
  const id = key.slice(5);
  await expect(
    await page.request.patch("/api/sessions/" + id, { data: { archived: true } }),
  ).toBeOK();
  await page.goto("/apps");
  await page.goto("/models?beside=" + encodeURIComponent(id));
  const chat = slot(page, key);
  await expect(chat.getByText(/This chat is archived/)).toBeVisible();
  const dock = chat.getByTestId("dock");
  await expect(dock.getByRole("tab", { name: /Models|Model Library/ })).toBeVisible();
  await expect(slot(page, "app:system_agent/models")).toBeVisible();
  await expect(page.getByRole("group", { name: "Right pane", exact: true })).toHaveCount(0);
  const stored = await (await page.request.get("/api/sessions/" + id)).json();
  expect(stored.session?.archived ?? stored.archived).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chat.locator('[data-testid="dock"][data-position="bottom"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(page.getByRole("list", { name: "App Center" })).toBeVisible();
  await page.setViewportSize({ width: 1360, height: 820 });
  await page.goForward();
  await expect(dock.getByRole("tab", { name: /Models|Model Library/ })).toBeVisible();
  await page
    .locator("aside")
    .first()
    .getByRole("link", { name: /^App Center/ })
    .click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(slot(page, "catalog")).toHaveAttribute("data-pane", "full");
  await expect(page.getByRole("list", { name: "App Center" })).toBeVisible();
});

test("machine-qualified chats read their own session and leave an existing same-ID draft alone", async ({
  page,
}) => {
  const socket = await watchSocket(page, {
    // Both loopback machine routes serve real authenticated history and events.
    forwardPath: (path) => path.replace(/^\/server\/(office|studio)\/api\//, "/api/"),
  });
  const [localKey] = await start(page, "qualifieddraft");
  const id = localKey.slice(5);
  const local = await (await page.request.get("/api/sessions/" + id)).json();
  const draftKey = "penguin.chatDraft.session.qualifieddraft." + id;
  const localText = "Draft for the original machine";
  await slot(page, localKey).locator(composer).fill(localText);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), draftKey))
    .toContain(localText);
  for (const name of ["Office", "Studio"]) {
    const machine = name.toLowerCase();
    const path = "/server/" + machine + "/api/sessions/" + id;
    socket.answer("GET", path, {
      status: 200,
      body: { ...local, session: { ...local.session, title: name + " session" } },
    });
    const calls = socket.calls.length;
    await page.goto(
      "/chat/" + id + "?" + new URLSearchParams({ project: local.session.projectId, machine }),
    );
    const editor = page.locator('[data-workspace-page^="scoped-chat:"]:visible').locator(composer);
    await expect(page.getByRole("heading", { name: name + " session", exact: true })).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue("");
    expect(socket.calls.slice(calls).some((call) => call.path === path)).toBe(true);
    await editor.fill(name + " new draft");
    await page.goto("/chat/" + id);
    await expect(slot(page, localKey).locator(composer)).toHaveValue(localText);
  }
});
