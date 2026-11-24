import { expect, test } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

test("the default Agent and Support own separately removable workbenches", async ({
  page,
  browser,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  const project = "/api/projects/default_project";
  const agent = (id) => project + "/agents/" + id;
  const base = agent("default_agent") + "/workbenches/benchmark";
  const workbenches = async (id) =>
    (await (await page.request.get(agent(id) + "/workbenches")).json()).workbenches.map(
      (w) => w.id,
    );
  expect(await workbenches("default_agent")).toContain("benchmark");
  expect(await workbenches("default_agent")).not.toContain("support");
  expect(await workbenches("penguin_support")).toEqual(["support"]);
  expect(await workbenches("system_agent")).not.toContain("benchmark");
  const created = await page.request.post(project + "/agents", {
    data: { agentId: "presetordinary", name: "Ordinary agent" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  expect(await workbenches("presetordinary")).toEqual([]);
  await page.goto("/apps");
  const tile = page.locator('li[data-app="default_agent/benchmark"] > button');
  await expect(tile).toBeVisible();
  await expect(page.locator('li[data-app="system_agent/benchmark"]')).toHaveCount(0);
  await tile.click();
  await expect(page.getByRole("heading", { name: "Evaluation Center" })).toBeVisible();
  await page.goto("/app/default_project/default_agent/benchmark");
  await expect(page.getByRole("heading", { name: "Evaluation Center" })).toBeVisible();
  await page.getByRole("button", { name: /More.*Self-Evolution Workbench/ }).click();
  await expect(page.getByRole("menuitem", { name: /Version history/i })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Remove/i })).toBeVisible();
  await page.keyboard.press("Escape");
  expect((await page.request.put(base + "/enabled", { data: { enabled: false } })).ok()).toBe(true);
  await page.goto("/apps");
  await expect(tile).toHaveCount(0);
  expect((await page.request.put(base + "/enabled", { data: { enabled: true } })).ok()).toBe(true);
  await page.reload();
  await expect(tile).toBeVisible();
  expect((await page.request.delete(base)).ok()).toBe(true);
  await page.reload();
  await expect(tile).toHaveCount(0);
  expect(
    (
      await page.request.post(agent("default_agent") + "/plugins", {
        data: { names: ["agent-evaluation"] },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await expect(tile).toBeVisible();

  const outsider = await browser.newContext();
  try {
    await provisionAndLogin(outsider.request, "presetoutsider", "password123");
    expect([403, 404]).toContain(
      (await outsider.request.get(agent("default_agent") + "/workbenches")).status(),
    );
  } finally {
    await outsider.close();
  }
});
