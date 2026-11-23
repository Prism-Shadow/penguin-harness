import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

test("an App Center workbench lists archived Sessions and closes only their selected terminal groups", async ({
  page,
}) => {
  test.setTimeout(75000);
  await provisionAndLogin(page.request, "workbenchpick" + process.pid, "password123");
  await setAccountPrefs(page.request, { lang: "en" });
  const { projects } = await (await page.request.get("/api/projects")).json();
  const project = projects[0].projectId;
  const base = "/api/projects/" + project;
  const model = { provider: "custom", modelId: "claude-4-8" };
  await expect(
    await page.request.put(base + "/models", {
      data: {
        defaultModel: model,
        models: [
          { ...model, apiKey: "sk-test", baseUrl: process.env.MOCK_URL, contextWindow: 200000 },
        ],
      },
    }),
  ).toBeOK();
  async function session(title, archive) {
    const res = await page.request.post(base + "/agents/default_agent/sessions", { data: {} });
    await expect(res).toBeOK();
    const { session } = await res.json();
    await expect(
      await page.request.patch("/api/sessions/" + session.sessionId, {
        data: { title, ...(archive ? { archived: true } : {}) },
      }),
    ).toBeOK();
    return session;
  }
  const first = await session("Prior terminal", true);
  const second = await session("Working terminal", false);
  const none = await session("No terminal", false);
  async function create(s) {
    await expect(
      await page.request.post("/api/terminals", {
        data: { sessionId: s.sessionId, cwd: s.workspace },
      }),
    ).toBeOK();
  }
  await create(first);
  await create(first);
  await create(second);
  const counts = async () =>
    (
      await (
        await page.request.get("/api/terminals/projects/" + project + "/session-resources")
      ).json()
    ).counts;
  await expect.poll(counts).toEqual({ [first.sessionId]: 2, [second.sessionId]: 1 });
  await page.setViewportSize({ width: 375, height: 750 });
  await page.goto("/apps");
  const tile = page.locator('[data-app="system_agent/session-tools-terminal"] > button').first();
  await tile.click();
  const search = page.getByRole("textbox", { name: "Search all Sessions" });
  await expect(search).toBeVisible();
  const old = page.getByRole("button", { name: /Prior terminal/ });
  await expect(old).toContainText("Archived");
  await expect(old).toContainText("Open resources · 2");
  await expect(page.getByRole("checkbox", { name: /Select Session · No terminal/ })).toBeDisabled();
  const hasWrites = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("terminals")) hasWrites.push(r.url());
  });
  await page.getByRole("checkbox", { name: /Select Session · Prior terminal/ }).check();
  await page.getByRole("button", { name: /Close selected resources/ }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText("Prior terminal");
  await expect(confirm).toContainText("Running commands");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect(hasWrites).toEqual([]);
  await page.getByRole("button", { name: /Close selected resources/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(counts).toEqual({ [second.sessionId]: 1 });
  await expect(old).toContainText("Open resources · 0");
  await search.fill("Working terminal");
  await expect(old).toHaveCount(0);
  await page.getByRole("button", { name: /Working terminal/ }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(counts).toEqual({ [second.sessionId]: 1 });
  expect(
    (await (await page.request.get("/api/sessions/" + first.sessionId)).json()).session.archived,
  ).toBe(true);
  expect(hasWrites.filter((u) => u.endsWith("/close"))).toHaveLength(1);
  expect(hasWrites.filter((u) => u.endsWith("/api/terminals"))).toEqual([]);
  expect(none.sessionId).not.toBe(second.sessionId);
});
