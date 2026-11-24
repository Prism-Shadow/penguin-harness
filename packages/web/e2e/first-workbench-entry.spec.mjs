import { expect, test } from "@playwright/test";
import { setAccountPrefs } from "./account-prefs.mjs";
import { login, provisionAndLogin, provisionUser } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const guideId = "first-workbench-guide";
const title = "Your first workbench";

test("builds and installs a checklist beside the actual conversation", async ({ page }) => {
  await provisionAndLogin(page.request, "newguidetour", "password123");
  await setAccountPrefs(page.request, { lang: "en", initialPasswordBannerDismissed: true });
  const { projects } = await (await page.request.get(BASE + "/api/projects")).json();
  const project = projects[0].projectId,
    agent = "default_agent";
  const base = BASE + "/api/projects/" + project;
  const installed = await (await page.request.get(base + "/agents/" + agent + "/plugins")).json();
  expect(installed.workbenches).toContainEqual(
    expect.objectContaining({ name: guideId, plugin: guideId }),
  );
  const handler = base + "/agents/" + agent + "/workbenches";
  const receipt = (await (await page.request.get(handler + "?id=" + guideId)).json()).workbenches;
  expect(receipt.find((w) => w.id === guideId)?.tabs).toEqual([]);
  expect(
    (await (await page.request.get(handler + "/" + guideId + "/api/capabilities")).json())
      .onboarding,
  ).toBe("first-workbench");
  const center = await (await page.request.get(base + "/app-center")).json();
  expect(center.shortcuts.some((s) => s.workbenchId === guideId)).toBe(false);
  await page.goto(BASE + "/");
  const tour = page.getByRole("region", { name: title });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Open Models" }).click();
  await expect(page).toHaveURL(/\/models$/);
  const modelId = "claude-guide-checklist";
  // A local provider supplies a repeatable response to both real Session requests.
  const res = await page.request.put(base + "/models", {
    data: {
      models: [
        {
          provider: "custom",
          modelId,
          modelType: "anthropic",
          baseUrl: process.env.MOCK_URL,
          apiKey: "fixture-credential",
          contextWindow: 120000,
        },
      ],
      defaultModel: { provider: "custom", modelId },
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  // The provider connect window returns focus to the product after saving its credentials.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await tour.getByRole("button", { name: "Go to chat" }).click();
  const composer = page.locator('[data-slot="composer"]:visible').first();
  await expect(composer.getByText(modelId, { exact: true })).toBeVisible();
  await composer.getByText(modelId, { exact: true }).click();
  const picker = page.getByRole("dialog");
  await expect(picker).toBeVisible();
  await expect(tour).toBeHidden();
  await picker.getByText(modelId, { exact: true }).last().click();
  const text = "Plan a volunteer seed exchange";
  await composer.locator("textarea").fill(text);
  await composer.locator("textarea").press("Enter");
  await expect(page).toHaveURL(/\/chat\/(?!new)[^/?]+/);
  await expect(
    page.getByText("Count the seed packets and label each tray.", { exact: true }),
  ).toBeVisible();
  const transcript = page.locator('[data-find-region="conversation"]:visible');
  const readingHeight = (await transcript.boundingBox()).height;
  const toggleGuide = tour.getByRole("button", { name: title, exact: true });
  await toggleGuide.click();
  await expect(tour.getByRole("button", { name: "Use this conversation" })).toBeHidden();
  expect((await transcript.boundingBox()).height).toBe(readingHeight);
  await toggleGuide.click();
  await tour.getByRole("button", { name: "Use this conversation" }).click();
  await expect(tour.getByText(text, { exact: true })).toBeVisible();
  await tour.getByLabel("Changes for the checklist").fill("Include a tray count");
  await tour.getByRole("button", { name: "Generate checklist" }).click();
  await expect(tour.getByText("Seed exchange", { exact: true })).toBeVisible({ timeout: 45000 });
  await tour.getByRole("button", { name: "Install checklist" }).click();
  await expect(tour.getByRole("button", { name: "Open checklist" })).toBeVisible();
  await tour.getByRole("button", { name: "Open checklist" }).click();
  await expect(page).toHaveURL(/checklist-/);
  await expect(
    page
      .frameLocator('iframe[src*="checklist-"]')
      .first()
      .getByText("Seed exchange", { exact: true })
      .first(),
  ).toBeVisible();
  await tour.getByRole("button", { name: "Test checklist" }).click();
  await expect(tour.getByRole("status")).toContainText("Test passed");
  const zip = await page.request.get(
    await tour.getByRole("link", { name: "Download plugin" }).getAttribute("href"),
  );
  expect(zip.ok()).toBe(true);
  expect((await zip.body()).subarray(0, 2).toString()).toBe("PK");
  await tour.getByRole("button", { name: "Dismiss" }).click();
  await expect(tour).toHaveCount(0);
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^newguidetour/ })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByText("General", { exact: true }).first().click();
  await settings.getByRole("button", { name: "Start or resume guide" }).click();
  await expect(settings).toHaveCount(0);
  await expect(tour.getByRole("status")).toContainText("Test passed");
  await tour.getByRole("button", { name: "Dismiss" }).click();
  await page.goto(handler + "/" + guideId + "/ui/index.html");
  await expect(page).toHaveURL(/\/chat\/new$/);
  await expect(tour.getByRole("status")).toContainText("Test passed");
  await tour.getByRole("button", { name: "Dismiss" }).click();
  await page.reload();
  await expect(page.locator('[data-slot="composer"]:visible textarea')).toBeVisible();
  await expect(tour).toHaveCount(0);
  await page.goto(BASE + "/apps?" + new URLSearchParams({ app: agent + "/" + guideId }));
  await expect(tour.getByRole("status")).toContainText("Test passed");
});

test.describe("on a small touch screen", () => {
  test.use({
    viewport: { width: 320, height: 620 },
    hasTouch: true,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  test("keeps setup and the composer reachable before a model is configured", async ({ page }) => {
    await provisionAndLogin(page.request, "touchguidetour", "password123");
    await setAccountPrefs(page.request, {
      lang: "zh",
      themeMode: "dark",
      initialPasswordBannerDismissed: true,
    });
    await page.goto(BASE + "/");
    const tour = page.getByRole("region", { name: "我的第一个工作台" });
    await expect(tour.getByRole("button", { name: "打开模型库" })).toBeVisible();
    const input = page.locator('[data-slot="composer"]:visible textarea').first();
    await input.tap();
    await input.fill("Keep this draft");
    const frame = await tour.boundingBox(),
      composer = await input.boundingBox();
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(320);
    expect(frame.y + frame.height).toBeLessThanOrEqual(composer.y);
    await tour.getByRole("button", { name: "收起" }).tap();
    await expect(input).toHaveValue("Keep this draft");
    await expect(tour).toHaveCount(0);
    await page.reload();
    await expect(input).toBeVisible();
    await expect(tour).toHaveCount(0);
    const { projects } = await (await page.request.get(BASE + "/api/projects")).json();
    const base = BASE + "/api/projects/" + projects[0].projectId;
    const sessionList = await page.request.get(base + "/agents/default_agent/sessions");
    expect(sessionList.ok()).toBe(true);
    expect((await sessionList.json()).sessions).toEqual([]);
  });
});

for (const defaultModel of [false, true]) {
  test(`starts at the remaining step with a configured model and default=${defaultModel}`, async ({
    page,
  }) => {
    const user = defaultModel ? "guidewithdefault" : "guidewithprovider";
    await provisionAndLogin(page.request, user, "password123");
    await setAccountPrefs(page.request, { lang: "en", initialPasswordBannerDismissed: true });
    const project = (await (await page.request.get(BASE + "/api/projects")).json()).projects[0]
      .projectId;
    const model = { provider: "custom", modelId: "claude-guide-checklist" };
    await expect(
      await page.request.put(BASE + "/api/projects/" + project + "/models", {
        data: {
          models: [
            {
              ...model,
              apiKey: "fixture-key",
              baseUrl: process.env.MOCK_URL,
              contextWindow: 120000,
            },
          ],
          ...(defaultModel && { defaultModel: model }),
        },
      }),
    ).toBeOK();
    await page.goto(BASE + "/chat/new");
    const tour = page.getByRole("region", { name: title });
    await expect(tour).toContainText(defaultModel ? "3 / 6" : "2 / 6");
    await expect(tour.getByText("Open Models")).toHaveCount(0);
    if (!defaultModel) {
      await page
        .locator('[data-slot="composer"]:visible')
        .getByRole("button", { name: "Choose model", exact: true })
        .click();
      await page.getByRole("dialog").getByText(model.modelId, { exact: true }).last().click();
      await expect(tour).toContainText("3 / 6");
    }
    await tour.getByRole("button", { name: "Dismiss" }).click();
    await page.reload();
    await expect(page.locator('[data-slot="composer"]:visible textarea')).toBeVisible();
    await expect(tour).toHaveCount(0);
  });
}
test("a new agent opts in, and members can use a configured model without opening owner settings", async ({
  page,
}) => {
  const owner = "guidescopeowner",
    member = "guidescopeguest";
  await provisionAndLogin(page.request, owner, "password123");
  const project = (await (await page.request.get(BASE + "/api/projects")).json()).projects[0]
    .projectId;
  const base = BASE + "/api/projects/" + project;
  await expect(
    await page.request.post(base + "/agents", {
      data: { agentId: "archivist", name: "Archivist" },
    }),
  ).toBeOK();
  const inventory = await (await page.request.get(base + "/agents/archivist/plugins")).json();
  expect(inventory.workbenches.some((w) => w.plugin === guideId)).toBe(false);
  await provisionUser(member, "password123");
  await expect(await page.request.post(base + "/members", { data: { userId: member } })).toBeOK();
  await login(page.request, member, "password123");
  await setAccountPrefs(page.request, { lang: "en", initialPasswordBannerDismissed: true });
  await page.goto(BASE + "/app/" + project + "/default_agent/" + guideId);
  await expect(page).toHaveURL(/\/chat\/new$/);
  await expect(page.locator('[data-slot="composer"]:visible textarea')).toBeVisible();
  const tour = page.getByRole("region", { name: title });
  await expect(tour).toContainText("Ask the project owner");
  await expect(tour.getByRole("button", { name: "Open Models" })).toHaveCount(0);
  await page.goto(BASE + "/chat/new");
  await expect(page.locator('[data-slot="composer"]:visible textarea')).toBeVisible();
  await expect(tour).toHaveCount(0);
  await login(page.request, owner, "password123");
  const model = { provider: "custom", modelId: "claude-guide-checklist" };
  await expect(
    await page.request.put(base + "/models", {
      data: {
        models: [
          { ...model, apiKey: "fixture-key", baseUrl: process.env.MOCK_URL, contextWindow: 120000 },
        ],
        defaultModel: model,
      },
    }),
  ).toBeOK();
  await login(page.request, member, "password123");
  await page.reload();
  await expect(tour).toContainText("3 / 6");
});

test("saving a key in Models advances the guide without a page reload", async ({ page }) => {
  await provisionAndLogin(page.request, "guidemodelsettings", "password123");
  await setAccountPrefs(page.request, { lang: "en", initialPasswordBannerDismissed: true });
  const project = (await (await page.request.get(BASE + "/api/projects")).json()).projects[0]
    .projectId;
  const base = BASE + "/api/projects/" + project;
  await expect(
    await page.request.put(base + "/models", {
      data: {
        models: [
          {
            provider: "custom",
            modelId: "guide-local",
            modelType: "anthropic",
            baseUrl: process.env.MOCK_URL,
            contextWindow: 120000,
          },
        ],
      },
    }),
  ).toBeOK();
  await page.goto(BASE + "/chat/new");
  const guide = page.getByRole("region", { name: title });
  await guide.getByRole("button", { name: "Open Models" }).click();
  await page.getByPlaceholder("Search models: id / name / provider").fill("guide-local");
  const gear = page.getByRole("button", { name: /^Settings / }).last();
  await gear.click();
  await page.getByRole("menuitem", { name: "Group settings…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(guide).toBeHidden();
  await dialog.getByLabel("Custom base URL", { exact: true }).fill(process.env.MOCK_URL);
  await dialog.getByLabel("API key", { exact: true }).fill("fixture-only-key");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByLabel("API key", { exact: true })).toHaveCount(0);
  // The model library may offer to make this provider the project default.
  if (await dialog.isVisible()) await page.keyboard.press("Escape");
  await expect(guide).toContainText("2 / 6");
  await guide.getByRole("button", { name: "Go to chat" }).click();
  await expect(page.locator('[data-slot="composer"]:visible textarea')).toBeVisible();
});
