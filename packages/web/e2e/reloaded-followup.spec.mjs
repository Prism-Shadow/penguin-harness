/**
 * Regression for #89: a Task posted after reloading a completed Session must execute, and must
 * carry the whole draft.
 *
 * Calls ride the page's API socket, so the spec watches its frames (api-socket.mjs) rather
 * than HTTP responses, and answers the steer in the server's place to stage the race.
 */
import { test, expect } from "@playwright/test";
import { watchSocket } from "./api-socket.mjs";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "reloadedfollowupuser";
const P = "password123";

async function createSession(page) {
  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  const models = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
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
  expect(models.ok(), "put models").toBeTruthy();
  const session = await page.request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    {
      data: {
        provider: "custom",
        modelId: "claude-4-8",
        approvalMode: "always-ask",
      },
    },
  );
  expect(session.ok(), `create session: ${await session.text()}`).toBeTruthy();
  return (await session.json()).session.sessionId;
}

test("a stale steer response after reload queues the follow-up instead of stranding it", async ({
  page,
}) => {
  const sessionId = await createSession(page);
  const tasksPath = `/api/sessions/${sessionId}/tasks`;
  const steerPath = `/api/sessions/${sessionId}/steer`;
  const isTaskPost = (call) => call.method === "POST" && call.path === tasksPath;
  const frames = await watchSocket(page);
  await page.goto(`${BASE}/chat/${sessionId}`);
  const composer = page.locator("textarea").first();
  await composer.waitFor();

  await composer.fill("first task before reload");
  const firstAnswer = frames.nextAnswer(isTaskPost);
  await page.getByRole("button", { name: "发送" }).click();
  expect((await firstAnswer).status).toBe(202);

  // Reproduce the post-reload stale-state seam deterministically: the client still sees a
  // running Task, but /steer reports that the core run just ended. The fallback must use the
  // server's queue-if-busy path, which is safe on both sides of the completion race.
  await expect(page.getByRole("button", { name: "允许" })).toBeVisible();
  frames.answer("POST", steerPath, {
    status: 409,
    body: {
      error: {
        code: "not_running",
        message: "This Session has no Task in progress; send a new task instead.",
      },
    },
  });
  await page.reload();
  await composer.waitFor();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
  await expect(page.getByRole("button", { name: "允许" })).toBeVisible();

  await composer.fill("hello after reload");
  const steer = frames.nextCall((call) => call.method === "POST" && call.path === steerPath);
  const followUp = frames.nextCall(isTaskPost);
  const followUpAnswer = frames.nextAnswer(isTaskPost);
  await page.getByRole("button", { name: "发送给运行中的 Agent" }).click();
  // The steer goes first and meets the staged 409; the fallback then posts the whole draft
  // with queueIfBusy.
  await steer;
  expect((await followUp).body).toMatchObject({
    input: [{ type: "text", text: "hello after reload" }],
    queueIfBusy: true,
  });
  const answer = await followUpAnswer;
  expect(answer.status).toBe(202);
  expect(answer.body).toMatchObject({ queued: true });
  // The queued hint is now one line per entry carrying that entry's own content (the bare
  // "N queued" count is only the fallback for a server that predates pendingFollowUps), and
  // it ends in the icon-only recall control — which must still answer to its name (#287).
  await expect(
    page.getByText("跟进消息已排队，本轮结束后自动发送：hello after reload"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "撤回" })).toHaveCount(1);
  await expect(composer).toHaveValue("");

  // The first task completes, then the accepted follow-up reaches the LLM and produces a
  // second answer instead of remaining an inert 202 response.
  await page.getByRole("button", { name: "允许" }).click();
  await expect(page.getByText("Command finished; the result looks as expected.")).toHaveCount(2, {
    timeout: 30_000,
  });
});
