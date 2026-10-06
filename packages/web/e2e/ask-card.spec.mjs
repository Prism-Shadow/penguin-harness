/**
 * Question cards, end to end in the real app: an assistant reply carrying ```ask blocks renders as
 * answerable cards, a card refuses to submit an empty answer, "Other" is on every card, one
 * message's cards go out together through "Submit all", and Skip records a deliberate pass instead
 * of adopting the recommendation nobody picked. The composed answer travels as an ordinary user
 * message — which is what the mock's next turn acknowledges.
 *
 * The three cards (two in the first reply, one after the answer, then a plain acknowledgement)
 * come from the "ask card test" branch of mock-llm.mjs.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "askuser";
const P = "password123";

test("a reply that asks questions draws answerable cards", async ({ page }) => {
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

  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();
  const sessionId = sess.session.sessionId;

  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("ask card test");
  await page.getByRole("button", { name: "发送" }).click();

  // --- The round: two cards, drawn in place of the fences, one question each. ---
  const pending = page.locator('[data-ask-card="pending"]');
  await expect(pending).toHaveCount(2, { timeout: 30_000 });
  const first = page.locator("[data-ask-card]").nth(0);
  const second = page.locator("[data-ask-card]").nth(1);

  await expect(first).toContainText("How should we proceed?");
  await expect(second).toContainText("Which parts should ship?");
  // Single-select rows are radios; the recommended one carries the badge, and nothing is picked.
  await expect(first.getByRole("radio")).toHaveCount(2);
  await expect(first.getByRole("radio", { name: /Wait for review/ })).toContainText("推荐");
  await expect(first.getByRole("radio", { name: /Ship it now/ })).not.toContainText("推荐");
  await expect(first.getByRole("radio", { checked: true })).toHaveCount(0);
  // A multi-select card says so, and its rows are checkboxes.
  await expect(second.getByRole("checkbox")).toHaveCount(3);
  await expect(second).toContainText("可多选");

  // --- Submit with nothing chosen is refused, with the hint rather than a sent message. ---
  await first.getByRole("button", { name: /^提交/ }).click();
  await expect(first.getByText("请先选择一项，或点「跳过」")).toBeVisible();
  await expect(pending).toHaveCount(2);

  // --- Answer both, then send them as ONE message. ---
  await first.getByRole("radio", { name: /Wait for review/ }).click();
  await expect(page.getByText("2/2 题待回答")).toBeVisible();
  // The batch button waits for every remaining card to have an answer.
  const submitAll = page.getByRole("button", { name: "全部提交" });
  await expect(submitAll).toBeDisabled();

  // "Other" is on every card and is not authored by the model.
  await second.getByRole("button", { name: "其他（自行填写）" }).click();
  await second.getByRole("textbox").fill("Just the web part");
  await expect(submitAll).toBeEnabled();
  await submitAll.click();

  await expect(page.locator('[data-ask-card="sent"]')).toHaveCount(2);
  await expect(page.getByText("2/2 题待回答")).toHaveCount(0);
  // The composed answer is an ordinary user message, so the agent reads it as the next turn — the
  // mock's reply is the proof it arrived.
  await expect(page.getByText("Thanks — one last thing.")).toBeVisible({ timeout: 30_000 });

  // --- Skip: a deliberate pass is recorded, not a quiet adoption of a recommendation. ---
  await expect(pending).toHaveCount(1);
  const third = page.locator("[data-ask-card]").nth(2);
  await expect(third).toContainText("Anything else before I start?");
  await expect(third.getByRole("checkbox")).toHaveCount(2);
  await third.getByRole("button", { name: "跳过" }).click();

  await expect(page.locator('[data-ask-card="sent"]')).toHaveCount(3);
  await expect(third).toContainText("跳过，未作答");
  await expect(page.getByText("Acknowledged; nothing else to ask.")).toBeVisible({
    timeout: 30_000,
  });
});
