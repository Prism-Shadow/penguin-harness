import { expect, test } from "@playwright/test";
import { setAccountPrefs } from "./account-prefs.mjs";
import { provisionAndLogin } from "./auth.mjs";

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
  const center = await (await page.request.get(base + "/app-center")).json();
  expect(center.shortcuts.some((s) => s.workbenchId === guideId)).toBe(false);
  await page.goto(BASE + "/");
  const intro = page.getByRole("dialog", { name: "Connect a model provider first" });
  await intro.getByRole("button", { name: title }).click();
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
  await tour.getByRole("button", { name: "Go to chat" }).click();
  const composer = page.locator('[data-slot="composer"]:visible').first();
  await expect(composer.getByText(modelId, { exact: true })).toBeVisible();
  await composer.getByText(modelId, { exact: true }).click();
  const picker = page.getByRole("dialog");
  await expect(picker).toBeVisible();
  await picker.getByText(modelId, { exact: true }).last().click();
  const text = "Plan a volunteer seed exchange";
  await composer.locator("textarea").fill(text);
  await composer.locator("textarea").press("Enter");
  await expect(page).toHaveURL(/\/chat\/(?!new)[^/?]+/);
  await expect(
    page.getByText("Count the seed packets and label each tray.", { exact: true }),
  ).toBeVisible();
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
  await page.goto(BASE + "/apps?" + new URLSearchParams({ app: agent + "/" + guideId }));
  await expect(tour.getByRole("status")).toContainText("Test passed");
});

test.describe("on a small touch screen", () => {
  test.use({ viewport: { width: 320, height: 620 }, hasTouch: true });
  test("keeps setup and the composer reachable before a model is configured", async ({ page }) => {
    await provisionAndLogin(page.request, "touchguidetour", "password123");
    await setAccountPrefs(page.request, { lang: "en", initialPasswordBannerDismissed: true });
    await page.goto(BASE + "/");
    const intro = page.getByRole("dialog", { name: "Connect a model provider first" });
    await intro.getByRole("button", { name: title }).tap();
    const tour = page.getByRole("region", { name: title });
    await tour.getByRole("button", { name: "Go to chat" }).tap();
    const input = page.locator('[data-slot="composer"]:visible textarea').first();
    await input.tap();
    await input.fill("Keep this draft");
    const frame = await tour.boundingBox(),
      composer = await input.boundingBox();
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(320);
    expect(frame.y + frame.height).toBeLessThanOrEqual(composer.y);
    await tour.getByRole("button", { name: "Dismiss" }).tap();
    await expect(input).toHaveValue("Keep this draft");
    await expect(tour).toHaveCount(0);
    const { projects } = await (await page.request.get(BASE + "/api/projects")).json();
    const base = BASE + "/api/projects/" + projects[0].projectId;
    const sessionList = await page.request.get(base + "/agents/default_agent/sessions");
    expect(sessionList.ok()).toBe(true);
    expect((await sessionList.json()).sessions).toEqual([]);
  });
});
