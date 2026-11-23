import { expect, test } from "@playwright/test";
import { setAccountPrefs } from "./account-prefs.mjs";
import { provisionAndLogin } from "./auth.mjs";
import { zip } from "./workbench-zip.mjs";

const id = "first-workbench-guide";

// The host also ships independently of the guide. Install a minimal app under the same id
// when this checkout predates the package, using the real archive, sidebar and window routes.
async function installedGuide(request, base) {
  const list = await (await request.get(base + "?view=sidebar")).json();
  const installed = list.apps.find((app) => app.workbenchId === id);
  if (installed) return installed.title;
  const title = "First workbench walkthrough";
  const manifest = {
    name: id,
    version: "1.0.0",
    type: "module",
    penguin: {
      appCenter: { show: true, title },
      modules: [
        {
          name: "Workbench",
          requires: { host: { iface: "@prismshadow/penguin-server#WorkbenchHost", from: "Host" } },
          provides: { main: "@prismshadow/penguin-server#WorkbenchMain" },
          contributes: {
            "WebModule.sessionTabs": [
              {
                id: "guide.main",
                key: "main",
                title,
                renderer: { iframe: { src: "ui/index.html" } },
              },
            ],
          },
        },
      ],
    },
  };
  const result = await request.post(base + "/archive", {
    data: {
      dataBase64: zip({
        [id + "/package.json"]: JSON.stringify(manifest),
        [id + "/index.ts"]:
          'import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin"; export default { modules: { Workbench: { create() { return { api: { main: { async handle() { return {body:null}; } } } }; } } } } satisfies WorkbenchPackage;',
        [id + "/ui/index.html"]: "<!doctype html><title>Walkthrough</title>",
      }).toString("base64"),
    },
  });
  expect(result.ok(), await result.text()).toBe(true);
  expect((await result.json()).workbench.error).toBeFalsy();
  return title;
}

test("the initial provider dialog opens the installed guide and respects its sidebar setting", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "newguideentry", "password123");
  await setAccountPrefs(page.request, { lang: "en" });
  const baseUrl = process.env.BASE_URL;
  const { projects } = await (await page.request.get(baseUrl + "/api/projects")).json();
  const base =
    baseUrl + "/api/projects/" + projects[0].projectId + "/agents/default_agent/workbenches";
  const title = await installedGuide(page.request, base);
  const show = async (value) =>
    expect(
      (await page.request.patch(base + "/" + id + "/sidebar", { data: { show: value } })).ok(),
    ).toBe(true);
  await show(false);
  await page.goto(baseUrl + "/");
  const dialog = page.getByRole("dialog", { name: "Connect a model provider first" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: title })).toHaveCount(0);
  await show(true);
  await page.reload();
  await dialog.getByRole("button", { name: title }).click();
  await expect(page).toHaveURL(/\/apps\?app=default_agent%2Ffirst-workbench-guide$/);
  await expect(page.getByRole("region", { name: title })).toBeVisible();
  await page.goBack();
  await expect(page.locator('[data-slot="composer"] textarea').first()).toBeVisible();
  await expect(dialog).toHaveCount(0);
});
