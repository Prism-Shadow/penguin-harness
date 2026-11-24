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
  const member = await browser.newContext();
  try {
    const userId = "presetteammate";
    await provisionAndLogin(member.request, userId, "password123");
    const list = agent("default_agent") + "/workbenches";
    expect([403, 404]).toContain((await member.request.get(list)).status());
    const joined = await page.request.post(project + "/members", { data: { userId } });
    expect(joined.status(), await joined.text()).toBe(201);
    await setAccountPrefs(member.request, { lang: "en" });
    const memberPage = await member.newPage();
    await memberPage.goto("/app/default_project/default_agent/benchmark");
    await expect(memberPage.getByRole("heading", { name: "Evaluation Center" })).toBeVisible();

    const support = agent("penguin_support") + "/workbenches/support";
    const supportTile = page.locator('li[data-app="penguin_support/support"] > button');
    for (const [ownerId, id, plugin, sibling, siblingTile] of [
      ["default_agent", "benchmark", "agent-evaluation", support, supportTile],
      ["penguin_support", "support", "penguin-support", base, tile],
    ]) {
      const target = agent(ownerId) + "/workbenches/" + id;
      const history = await member.request.get(target + "/history");
      expect(history.status()).toBe(200);
      expect((await history.json()).versions.length).toBeGreaterThan(0);
      expect((await member.request.delete(target)).status()).toBe(204);
      expect((await member.request.get(target + "/manifest.webmanifest")).status()).toBe(404);
      expect((await member.request.get(sibling + "/manifest.webmanifest")).status()).toBe(200);
      await page.reload();
      await expect(siblingTile).toBeVisible();
      const removedTile = page.locator(`li[data-app="${ownerId}/${id}"] > button`);
      await expect(removedTile).toHaveCount(0);

      const installed = await member.request.post(agent(ownerId) + "/plugins", {
        data: { names: [plugin] },
      });
      expect(installed.status(), await installed.text()).toBe(201);
      expect((await member.request.get(target + "/manifest.webmanifest")).status()).toBe(200);
      await page.reload();
      await expect(removedTile).toBeVisible();
    }
  } finally {
    await member.close();
  }
});
