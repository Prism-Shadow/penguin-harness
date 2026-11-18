import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const base = process.env.BASE_URL;
const providers = ["custom", "deepseek"];
const recognition = "deepseek-asr";
const synthesis = "deepseek-tts";

async function search(page, model) {
  await page.getByPlaceholder(/Search models|搜索模型/).fill(model);
}
function card(page, name) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="name"]').filter({ hasText: name }) });
}
async function switchProject(page, from, to) {
  await page.getByRole("button", { name: from, exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp("^" + to) })
    .first()
    .click();
  await expect(page.getByRole("button", { name: to, exact: true })).toBeVisible();
}
test("model cards replace only their project's single capability and update other open views", async ({
  page,
  context,
  browser,
}) => {
  const user = "cardselection";
  await provisionAndLogin(page.request, user, "password123");
  await setAccountPrefs(page.request, { lang: "en" });
  const a = (await (await page.request.get(base + "/api/projects")).json()).projects[0].projectId;
  const b = user + "-second";
  expect(
    (await page.request.patch(base + "/api/projects/" + a, { data: { name: "Cards Alpha" } })).ok(),
  ).toBeTruthy();
  const created = await page.request.post(base + "/api/projects", {
    data: { projectId: b, name: "Cards Beta" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  for (const project of [a, b]) {
    const models = providers.flatMap((provider, index) =>
      [recognition, synthesis].map((modelId) => ({
        provider,
        modelId,
        displayName:
          (index ? "Lake " : "River ") + (modelId === recognition ? "recognition" : "synthesis"),
        contextWindow: 32000,
        clientType: "mmsp",
        apiKey: "local-test",
        baseUrl: process.env.MOCK_URL + "/v1",
      })),
    );
    const put = await page.request.put(base + "/api/projects/" + project + "/models", {
      data: { models },
    });
    expect(put.ok(), await put.text()).toBeTruthy();
  }
  const settings = async (project) =>
    (await (await page.request.get(base + "/api/projects/" + project + "/capabilities")).json())
      .bindings;
  await page.addInitScript((project) => localStorage.setItem("penguin.lastProjectId", project), a);
  await page.goto(base + "/models");
  await search(page, recognition);
  const other = await context.newPage();
  await other.goto(base + "/models");
  await search(other, recognition);
  const current = "Current for Speech recognition",
    assign = "Use for Speech recognition";
  const role = (row, label) => row.getByRole("button", { name: label, exact: true });
  await role(card(page, "River recognition"), assign).click();
  await expect(role(card(other, "River recognition"), current)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await role(card(page, "Lake recognition"), assign).click();
  await expect(role(card(page, "River recognition"), assign)).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(role(card(other, "Lake recognition"), current)).toBeVisible();
  await expect
    .poll(() => settings(a))
    .toEqual({ stt: { provider: "deepseek", modelId: recognition } });
  expect(await settings(b)).toEqual({});
  if (process.env.VOICE_EVIDENCE)
    await page.screenshot({ path: process.env.VOICE_EVIDENCE + "/cards-alpha.png" });
  await search(page, synthesis);
  await role(card(page, "River synthesis"), "Use for Speech synthesis").click();
  await expect
    .poll(() => settings(a))
    .toEqual({
      stt: { provider: "deepseek", modelId: recognition },
      tts: { provider: "custom", modelId: synthesis },
    });
  await page.reload();
  await search(page, recognition);
  await expect(role(card(page, "Lake recognition"), current)).toBeVisible();
  await switchProject(page, "Cards Alpha", "Cards Beta");
  await search(page, recognition);
  await expect(role(card(page, "Lake recognition"), assign)).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await role(card(page, "River recognition"), assign).click();
  await expect
    .poll(() => settings(b))
    .toEqual({ stt: { provider: "custom", modelId: recognition } });
  await expect(role(card(other, "Lake recognition"), current)).toBeVisible();
  await page.getByRole("button", { name: "CLI and voice models" }).click();
  await expect(page.getByRole("button", { name: /^Speech recognition/ })).toContainText(
    "deepseek-asr · custom",
  );
  await page.getByRole("button", { name: /^Speech recognition/ }).click();
  await page.getByRole("option", { name: "Not assigned", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(role(card(page, "River recognition"), assign)).toBeVisible();
  await switchProject(page, "Cards Beta", "Cards Alpha");
  await search(page, recognition);
  await expect(role(card(page, "Lake recognition"), current)).toBeVisible();
  await setAccountPrefs(page.request, { lang: "zh" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await search(page, recognition);
  expect((await page.getByPlaceholder(/搜索模型/).boundingBox()).width).toBeGreaterThan(250);
  await expect(role(card(page, "Lake recognition"), "当前语音识别模型")).toBeVisible();
  await expect(role(card(page, "River recognition"), "设为语音识别模型")).toBeVisible();
  if (process.env.VOICE_EVIDENCE)
    await page.screenshot({ path: process.env.VOICE_EVIDENCE + "/cards-mobile-zh.png" });
  const member = await browser.newContext();
  try {
    const reader = "cardreader";
    await provisionAndLogin(member.request, reader, "password123");
    await setAccountPrefs(member.request, { lang: "en" });
    const add = await page.request.post(base + "/api/projects/" + a + "/members", {
      data: { userId: reader },
    });
    expect(add.ok(), await add.text()).toBeTruthy();
    const memberPage = await member.newPage();
    await memberPage.addInitScript(
      (project) => localStorage.setItem("penguin.lastProjectId", project),
      a,
    );
    await memberPage.goto(base + "/models");
    await search(memberPage, recognition);
    await expect(
      card(memberPage, "Lake recognition").getByText(current, { exact: true }),
    ).toBeVisible();
    await expect(memberPage.getByRole("button", { name: assign, exact: true })).toHaveCount(0);
    expect(
      (
        await member.request.patch(base + "/api/projects/" + a + "/capabilities", {
          data: { bindings: { stt: null } },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await member.close();
  }
  await other.close();
});
