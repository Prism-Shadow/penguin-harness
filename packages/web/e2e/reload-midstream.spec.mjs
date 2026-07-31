/**
 * Reload mid-stream: while a Task streams a long tool output (or a long assistant text),
 * refreshing the page must bring the in-progress message straight back — the already
 * streamed prefix visible promptly (before the stream finishes), the content still
 * growing live, and the final state identical to a run that was never reloaded.
 *
 * Mechanics under test: GET /messages returns `live` ({cursor, fragments}) while the
 * Task runs; the frontend seeds the synthetic `partial_* start` fragments on top of
 * history and drops the buffered partials the snapshot already covers.
 *
 * The LLM is mock-llm.mjs: "slow stream test" makes it call exec_command with a command
 * that prints one line every 200ms for ~8s (real tool execution, really streamed);
 * "slow text test" streams a 40-chunk text one delta every 200ms.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "reloaduser";
const P = "password123";

/** Create a session for the user's auto-provisioned project (models PUT is idempotent). */
async function createSession(page, approvalMode) {
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
  const approval = await page.request.put(`${BASE}/api/settings/approval-mode`, {
    data: { approvalMode },
  });
  expect(approval.ok(), "set approval mode").toBeTruthy();
  const res = await page.request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8" } },
  );
  expect(res.ok(), `create session: ${await res.text()}`).toBeTruthy();
  return (await res.json()).session.sessionId;
}

/**
 * Keep the running work group open past the end of the turn (it auto-collapses at turn
 * end unless the user toggled it — same trick as chat.spec), then expand the
 * exec_command tool card and return the output <pre> locator.
 */
async function openToolOutput(page) {
  const group = page
    .locator("button[aria-expanded]")
    .filter({ hasText: /运行中|运行完毕/ })
    .first();
  await expect(group).toBeVisible();
  if ((await group.textContent())?.includes("运行中")) {
    await group.click(); // toggle → marks the group user-toggled
    await group.click(); // toggle back → deliberately kept open, survives turn end
  } else if ((await group.getAttribute("aria-expanded")) !== "true") {
    await group.click(); // finished and collapsed: open it to reach the card
  }
  const toolCard = page
    .locator("button[aria-expanded]")
    .filter({ hasText: "exec_command" })
    .first();
  await expect(toolCard).toBeVisible();
  if ((await toolCard.getAttribute("aria-expanded")) !== "true") await toolCard.click();
  await expect(toolCard).toHaveAttribute("aria-expanded", "true");
  // Two <pre>s live in the expanded card (arguments, then output); the output one is the
  // only one containing a literal "line 1".
  return page.locator("pre", { hasText: /line 1\b/ }).first();
}

/** Send the "slow stream test" prompt, approve exec_command, and return the output <pre>. */
async function startSlowToolRun(page, sessionId) {
  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("slow stream test");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("exec_command").first()).toBeVisible();
  await page.getByRole("button", { name: "允许" }).click();
  const outputPre = await openToolOutput(page);
  await expect(outputPre).toContainText("line 3");
  return outputPre;
}

test("in-progress tool output survives a reload: prefix back promptly, still growing, final state matches a never-reloaded run", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);

  // --- Control run (never reloaded): capture the final tool output to compare against ---
  const controlId = await createSession(page, "always-ask");
  await startSlowToolRun(page, controlId);
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible({
    timeout: 30_000,
  });
  const controlPre = await openToolOutput(page);
  const controlOutput = await controlPre.textContent();
  expect(controlOutput).toContain("line 40");

  // --- The run under test: reload while the output is streaming ---
  const sessionId = await createSession(page, "always-ask");
  await startSlowToolRun(page, sessionId);
  await page.reload();

  // (a) The already-streamed prefix is back promptly — well before the ~8s command ends.
  const outputPre = await openToolOutput(page);
  await expect(outputPre).toContainText("line 2", { timeout: 4000 });
  // Not finished yet: what we see is genuinely the in-progress stream, not the final state.
  await expect(outputPre).not.toContainText("line 40");

  // (b) The output keeps growing live on the same connection.
  await expect(outputPre).toContainText("line 35", { timeout: 15_000 });

  // (c) After completion the final state matches the never-reloaded run exactly
  //     (every line exactly once — no lost prefix, no duplicated overlap).
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible({
    timeout: 30_000,
  });
  const reloadedOutput = await (await openToolOutput(page)).textContent();
  expect(reloadedOutput).toBe(controlOutput);
});

test("in-progress assistant TEXT survives a reload and keeps streaming", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  const sessionId = await createSession(page, "allow-all");

  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("slow text test");
  await page.getByRole("button", { name: "发送" }).click();

  const reply = page.locator(".md-body", { hasText: /chunk-1\s/ }).first();
  await expect(reply).toContainText("chunk-3 ");
  await page.reload();

  // (a) The streamed prefix is back promptly, while the ~8s stream is still going.
  const reloaded = page.locator(".md-body", { hasText: /chunk-1\s/ }).first();
  await expect(reloaded).toContainText("chunk-2 ", { timeout: 4000 });
  await expect(reloaded).not.toContainText("chunk-40");

  // (b) It keeps streaming live, up to the full reply.
  await expect(reloaded).toContainText("chunk-40", { timeout: 15_000 });

  // (c) No duplicated prefix: the buffered partials the snapshot covered were dropped,
  //     so every chunk appears exactly once.
  const text = await reloaded.textContent();
  expect(text.match(/chunk-5 /g)).toHaveLength(1);
  expect(text.match(/chunk-1 /g)).toHaveLength(1);
});
