import { expect, test } from "@playwright/test";
import { setAccountPrefs } from "./account-prefs.mjs";
import { provisionAndLogin } from "./auth.mjs";

test("the initial model dialog launches the installed guide using its localized title", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "newguideentry", "password123");
  await setAccountPrefs(page.request, { lang: "en" });
  const title = "First workbench walkthrough";
  const workbenchId = "first-workbench-guide";
  // The host also ships independently of the guide. Drive both catalog states on one Project.
  let available = false;
  await page.route(/\/agents\/default_agent\/workbenches\?view=sidebar$/, async (route) => {
    await route.fulfill({
      json: {
        apps: available
          ? [
              {
                agentId: "default_agent",
                agentName: "Default",
                workbenchId,
                title,
                tab: "main",
                path: "/app/newguideentry-default_project/default_agent/first-workbench-guide/main",
                build: "ready",
              },
            ]
          : [],
      },
    });
  });
  await page.goto(process.env.BASE_URL + "/");
  const dialog = page.getByRole("dialog", { name: "Connect a model provider first" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: title })).toHaveCount(0);
  available = true;
  await page.reload();
  await dialog.getByRole("button", { name: title }).click();
  await expect(page).toHaveURL(/\/apps\?app=default_agent%2Ffirst-workbench-guide$/);
  await expect(dialog).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('[data-slot="composer"] textarea').first()).toBeVisible();
  await expect(dialog).toHaveCount(0);
});
