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
  const terminalTile = page
    .locator('[data-app="system_agent/session-tools-terminal"] > button')
    .first();
  const counts = async () =>
    (
      await (
        await page.request.get("/api/terminals/projects/" + project + "/session-resources")
      ).json()
    ).counts;
  await page.setViewportSize({ width: 375, height: 750 });
  await page.goto("/apps");
  await terminalTile.click();
  await expect(page.getByText("No matching Sessions.", { exact: true })).toBeVisible();
  expect(await counts()).toEqual({});
  await page.goBack();

  async function session(title, archive) {
    const res = await page.request.post(base + "/agents/default_agent/sessions", {
      data: { approvalMode: "allow-all" },
    });
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
  await expect(
    await page.request.post("/api/sessions/" + second.sessionId + "/tasks", {
      data: { input: [{ type: "text", text: "run a subagent" }] },
    }),
  ).toBeOK();
  let child;
  await expect
    .poll(async () => {
      const reply = await page.request.get(
        base + "/agents/default_agent/sessions?limit=30&order=activity",
      );
      const sessions = (await reply.json()).sessions;
      child = sessions.find((row) => row.source === "subagent");
      return child?.sessionId;
    })
    .toBeTruthy();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/sessions/" + second.sessionId)).json()).session.status,
    )
    .toBe("idle");
  await expect(
    await page.request.patch("/api/sessions/" + second.sessionId, {
      data: { title: "Working terminal" },
    }),
  ).toBeOK();
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
  await create(child);
  await expect
    .poll(counts)
    .toEqual({ [first.sessionId]: 2, [second.sessionId]: 1, [child.sessionId]: 1 });
  await page.goto("/apps");
  await terminalTile.click();
  const search = page.getByRole("textbox", { name: "Search all Sessions" });
  await expect(search).toBeVisible();
  const old = page.getByRole("button", { name: /Prior terminal/ });
  await expect(old).toContainText("Archived");
  await expect(old).toContainText("Open resources · 2");
  await expect(page.getByRole("checkbox", { name: /Select Session · No terminal/ })).toBeDisabled();
  const childRow = page.getByRole("button").filter({ hasText: child.sessionId });
  await expect(childRow).toContainText("Subagent");
  await expect(childRow).toContainText("Open resources · 1");
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
  await childRow.locator("..").getByRole("checkbox").check();
  await page.getByRole("button", { name: /Close selected resources/ }).click();
  await expect(page.getByRole("dialog")).toContainText(child.title || child.sessionId);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(counts).toEqual({ [second.sessionId]: 1 });
  await expect(old).toContainText("Open resources · 0");
  await search.fill("Working terminal");
  await expect(old).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  const match = page
    .getByRole("region", { name: "Terminal", exact: true })
    .getByRole("button", { name: /Working terminal/ });
  await expect(match).toContainText("Open resources · 1");
  await match.focus();
  await page.keyboard.press("Enter");
  const attached = page.locator(
    '[data-testid="dock-tab"][data-tab-id^=":app:session-tool/terminal"]',
  );
  await expect(attached).toBeVisible();
  await expect(
    page.locator('[data-pane="left"][data-workspace-page*="' + second.sessionId + '"]'),
  ).toBeVisible();
  await attached.getByTestId("dock-tab-close").click();
  await expect(page).toHaveURL(new RegExp("/chat/" + second.sessionId));
  await expect.poll(counts).toEqual({ [second.sessionId]: 1 });
  expect(
    (await (await page.request.get("/api/sessions/" + first.sessionId)).json()).session.archived,
  ).toBe(true);
  expect(hasWrites.filter((u) => u.endsWith("/close"))).toHaveLength(1);
  expect(hasWrites.filter((u) => u.endsWith("/api/terminals"))).toEqual([]);
  const chat = page.locator('[data-pane="full"][data-workspace-page*="' + second.sessionId + '"]');
  const composer = chat.locator('[data-slot="composer"] textarea').first();
  await composer.fill("Keep my draft while browsing");
  for (const kind of ["workspace", "memory", "agents", "trace"]) {
    await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
    await page.getByTestId("dock-launcher-open-" + kind).click();
    const tab = page.locator(
      '[data-testid="dock-tab"][data-tab-id^=":app:session-tool/' + kind + '"]',
    );
    await expect(tab).toBeVisible();
    await expect(page).toHaveURL(new RegExp("/session-tools/" + kind + "\\?"));
    expect(new URL(page.url()).searchParams.get("session")).toBe(second.sessionId);
    await tab.getByTestId("dock-tab-close").click();
    await expect(composer).toHaveValue("Keep my draft while browsing");
  }
  expect(none.sessionId).not.toBe(second.sessionId);
});
