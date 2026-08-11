/**
 * Parked draft conversations (draft-sessions.ts): typing in the new-chat composer and
 * clicking "New chat" again parks the text as a draft row in the sidebar list; opening
 * the row resumes the full draft at /chat/draft-…; sending it creates the real session
 * and removes the row; deleting from the row's hover action discards it after a confirm.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "parkuser";
const P = "password123";

test("new-chat click parks typed text as a sendable draft conversation", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();

  await page.goto(`${BASE}/chat/new`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("draft to park: build me a metronome");

  // Clicking "New chat" parks the typed text: a 草稿 group appears with the row, and the
  // composer comes back empty.
  await page.getByRole("button", { name: "新建对话" }).first().click();
  const draftGroup = page.getByRole("button", { name: /折叠|展开/ }).filter({ hasText: "草稿" });
  await expect(draftGroup).toBeVisible();
  const row = page.getByText("draft to park: build me a metronome").first();
  await expect(row).toBeVisible();
  await expect(ta).toHaveValue("");

  // Opening the row resumes the draft (route /chat/draft-…, text restored).
  await row.click();
  await expect(page).toHaveURL(/\/chat\/draft-[0-9a-f]{8}$/);
  await expect(page.getByPlaceholder(/输入消息/)).toHaveValue(
    "draft to park: build me a metronome",
  );

  // Sending converts it into a real session and the draft row disappears.
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/session-/, { timeout: 15_000 });
  await expect(page.getByText("draft to park: build me a metronome").first()).toBeVisible(); // the sent message
  await expect(draftGroup).toHaveCount(0); // group hides once the list is empty

  // Park another one and delete it from the row (confirm dialog).
  await page.getByRole("button", { name: "新建对话" }).first().click();
  await page.getByPlaceholder(/输入消息/).fill("second parked draft");
  await page.getByRole("button", { name: "新建对话" }).first().click();
  const row2 = page.getByText("second parked draft").first();
  await expect(row2).toBeVisible();
  await row2.hover();
  await page.getByRole("button", { name: "删除草稿" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("second parked draft")).toHaveCount(0);
});
