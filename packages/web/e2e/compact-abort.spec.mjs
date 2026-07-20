/**
 * `/compact` after an abort: it must give clear feedback instead of silently doing nothing.
 *
 * When the first request is aborted, token_usage was never received -> core's sessionTurns is
 * still 0 -> `compact()` returns immediately, **producing no message at all**. The server used
 * to still return 202, so the frontend would wait forever for a compaction banner that never
 * comes — from the user's perspective, it just looks like "nothing happened after sending the
 * compact command." Now the server explicitly returns 409 based on `session.compactability()`.
 *
 * Second test case: compacting twice in a row. The internal state is identical to the above
 * (sessionTurns === 0), but the message the user should see is completely different — they just
 * finished a full round and just compacted, so being told "no completed conversation round yet"
 * would be absurd and effectively say nothing useful.
 *
 * This file is deliberately named to sort after chat.spec: the first user registered becomes the
 * admin, which chat.spec relies on, and Playwright runs spec files in filename order (the other
 * specs also sort after it).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "abortcompact";
const P = "password123";

test("aborting before any turn completes: /compact says so instead of doing nothing", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
          pricing: { cacheRead: 1, cacheWrite: 5, output: 10 },
        },
      ],
    },
  });
  // always-ask: while approval is pending the request hasn't closed yet; aborting now means token_usage was never produced.
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "always-ask" },
    })
  ).json();
  const sessionId = sess.session.sessionId;

  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("Help me set up @theme");
  await page.getByRole("button", { name: "发送" }).click();
  // Wait for the approval to be pending before aborting: at this point the LLM stream has
  // already finished sending, the engine is blocked on `await approve(tc)`, and the generator is
  // suspended at `yield`. This is where an abort most commonly lands, and it used to be the
  // trigger for a **permanent session hang** — if the abort still went back to pull from the
  // already-aborted upstream stream, `it.next()` would never settle, the run would never close,
  // and the Session would stay stuck at running: the frontend's /compact is gated behind
  // `!running`, so pressing it would do nothing at all (see the abort pre-check in core's
  // generative-model).
  await expect(page.getByRole("button", { name: "允许" })).toBeVisible();

  await page.getByRole("button", { name: "停止" }).click();
  // The abort must converge back to idle (don't wait for "发送" ("Send") — it only appears
  // when the input box has content, and the input box is empty at this point).
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);

  // The actual user path: type /compact in the input box and press Enter (slash menu).
  // Feedback goes through a **top toast** (the Toaster from components/ui/toast; the toast
  // itself is a clickable, dismissible button), not a native browser alert — the latter would
  // trigger Playwright's dialog event, which lets us assert we didn't fall back to it.
  const nativeDialogs = [];
  page.on("dialog", (d) => {
    nativeDialogs.push(d.message());
    void d.dismiss();
  });
  await ta.fill("/compact");
  await ta.press("Enter");

  // There must be feedback — silently doing nothing is exactly the bug being tested for.
  await expect(page.getByRole("button", { name: /nothing to compact/ })).toBeVisible();
  expect(nativeDialogs, "feedback must be an in-app toast, not a native alert").toHaveLength(0);
  // And indeed no compaction was started (no banner).
  await expect(page.getByText(/\[压缩\]/)).toHaveCount(0);
});

test("compacting twice in a row: says the context was just compacted, not that nothing ever ran", async ({
  page,
}) => {
  const U2 = "dblcompact";
  await provisionAndLogin(page.request, U2, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
          pricing: { cacheRead: 1, cacheWrite: 5, output: 10 },
        },
      ],
    },
  });
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();

  await page.goto(`${BASE}/chat/${sess.session.sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("Help me set up @theme");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();

  const nativeDialogs = [];
  page.on("dialog", (d) => {
    nativeDialogs.push(d.message());
    void d.dismiss();
  });

  // First /compact: compacts normally, shows the banner, no toast expected.
  await ta.fill("/compact");
  await ta.press("Enter");
  await expect(page.getByText(/\[压缩\]/)).toBeVisible();
  // No compact-unavailable toast (match the 409 reasons, not bare "compact" — usernames like
  // "dblcompact" would collide).
  await expect(
    page.getByRole("button", { name: /compaction configured|nothing to compact|just compacted/ }),
  ).toHaveCount(0);

  // Second /compact: there's no conversation yet in the new context -> tell the user clearly, and the wording must match reality.
  await ta.fill("/compact");
  await ta.press("Enter");
  await expect(page.getByRole("button", { name: /just compacted/ })).toBeVisible();
  // Having just finished a full round, saying "no completed conversation round yet" would be absurd.
  await expect(
    page.getByRole("button", { name: /no completed conversation turns yet/ }),
  ).toHaveCount(0);
  expect(nativeDialogs, "feedback must be an in-app toast, not a native alert").toHaveLength(0);
  await expect(page.getByText(/\[压缩\]/)).toHaveCount(1); // no second compaction banner
});
