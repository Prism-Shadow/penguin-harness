/**
 * Auto-compaction triggered at the **end** of a round: item order is
 * assistant_text -> compaction -> task_stats, with the compaction banner sandwiched between
 * the reply and its stats line.
 *
 * This ordering used to break the "reply + stats line" pairing, leaving the stats line
 * orphaned — and since the whole line is transparent by default, being orphaned meant it was
 * neither visible nor hoverable (the element's own `group` class has no effect on itself:
 * group-hover is a descendant selector). Now the entire round's AI-side content, stats line
 * included, is wrapped in the same group, so hovering any content in the round reveals it.
 *
 * Trigger mechanism: the mock's usage grows with context length, pinning the threshold between
 * "below the first request" and "above the second request (which carries the tool result)", so
 * compaction only happens once, at the end of the round.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "compactuser";
const P = "password123";
/** Context window: the engine takes 75% as the compaction threshold (240 x 0.75 = 180), landing between the two requests' usage. */
const CONTEXT_WINDOW = 240;

test("compaction mid-turn: the reply's stats line is still reachable by hovering the reply", async ({
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
          contextWindow: CONTEXT_WINDOW,
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
  await ta.fill("帮我配置 @theme");
  await page.getByRole("button", { name: "发送" }).click();

  const reply = page.getByText("命令已执行完成，结果符合预期。").first();
  await expect(reply).toBeVisible();
  const banner = page.getByText(/\[压缩\]/).first();
  await expect(banner).toBeVisible();

  // The compaction banner doesn't show Token counts: compaction at round end isn't attributed
  // to this round (its usage shows up in the Session total and the Trace page's compaction-round
  // card instead) — the banner only states "compaction happened, succeeded or not."
  await expect(page.getByText(/\[压缩\].*tokens/)).toHaveCount(0);

  // Order: reply -> **this round's stats line** -> compaction banner. The stats line is about
  // this round of conversation; compaction is housekeeping outside this round, listed after this
  // round's tally. (It used to be the other way around: the banner sat between the reply and the
  // stats line, making the stats line read like "compaction's stats," and this round's elapsed
  // time would fold in the entire compaction request — compaction is itself a full LLM request.)
  const copyBtn = page.getByRole("button", { name: "复制回复" }).first();
  const statsLine = copyBtn.locator("xpath=..");
  const yOf = async (l) => (await l.boundingBox()).y;
  expect(await yOf(statsLine)).toBeGreaterThan(await yOf(reply));
  expect(await yOf(banner)).toBeGreaterThan(await yOf(statsLine));

  // Transparent by default but space-reserved; hovering **the reply itself** reveals it
  // (it used to be orphaned -> never revealable).
  await page.mouse.move(0, 0);
  await expect(statsLine).toHaveCSS("opacity", "0");
  await reply.hover();
  await expect(statsLine).toHaveCSS("opacity", "1");
  await expect(statsLine.locator("text=/\\d{1,2}:\\d{2}/")).toBeVisible();

  // Compaction succeeded and no ordinary request has reported usage since, so the context ring must
  // read UNKNOWN (`—`), not 0. Zero would claim the context is empty — but the summary itself costs
  // tokens; we simply have not measured the new size yet.
  await expect(page.getByText(`—/${CONTEXT_WINDOW}`)).toBeVisible();
  await expect(page.getByText(`0/${CONTEXT_WINDOW}`)).toHaveCount(0);

  // —— Trace page ——
  // Compaction is its own round: the user round's elapsed time and TPS don't include compaction
  // (matching the chat page's convention), and the compaction round has **its own TPS** (how
  // fast the summary was generated), not a "—".
  await page.goto(`${BASE}/traces`);
  const main = page.locator("main");
  const node = main.getByText(/配置|新对话/).first();
  await expect(node).toBeVisible();
  await node.click();
  await expect(main.getByText("第 1 轮")).toBeVisible();
  await expect(main.getByText("第 2 轮")).toBeVisible();
  const roundRows = main.locator("button").filter({ hasText: /第 \d 轮/ });
  const compactionRow = roundRows.filter({ hasText: "第 2 轮" }).first();
  await expect(compactionRow).toContainText("tok/s"); // the compaction round has its own TPS
  await expect(compactionRow).not.toContainText("—");

  // Global elapsed time = **the sum of each round's elapsed time (including the compaction
  // round)**, matching the same scope as the per-round display below — adding up each round
  // card's elapsed time must equal the total. But it's not "last message - first message" (that
  // would include the gap while the user was thinking/away between rounds, which isn't the
  // Agent's working time). Assert this property directly against the API — the elapsed time
  // shown in the UI is rounded by humanizeDuration, so parsing it back out of the text would be
  // both fragile and inaccurate.
  const traces = await (
    await page.request.get(`${BASE}/api/projects/${projectId}/agents/default_agent/traces`)
  ).json();
  const file = traces.dates[0].sessions[0].files[0];
  const analysis = await (
    await page.request.get(
      `${BASE}/api/projects/${projectId}/agents/default_agent/traces/${sess.session.sessionId}/${file.index}/analysis`,
    )
  ).json();
  expect(analysis.tasks).toHaveLength(2);

  // The compaction round is flagged as "compaction" and counts toward the total elapsed time
  // just like a user round; each has an elapsed time greater than 0.
  const userTasks = analysis.tasks.filter((t) => t.compaction !== true);
  const compactionTasks = analysis.tasks.filter((t) => t.compaction === true);
  expect(userTasks).toHaveLength(1);
  expect(compactionTasks).toHaveLength(1);
  const allSum = analysis.tasks.reduce(
    (acc, t) => acc + (Date.parse(t.endTs) - Date.parse(t.startTs)),
    0,
  );
  expect(analysis.elapsedMs).toBe(allSum);
  expect(
    Date.parse(compactionTasks[0].endTs) - Date.parse(compactionTasks[0].startTs),
  ).toBeGreaterThan(0);
});

/**
 * Manual `/compact` between two rounds: reloading the page must **not** rewrite the previous
 * round's tally.
 *
 * The server's startCompact requires the Session to be idle, so manual compaction always falls
 * outside a round. In the live stream, the previous round already closed at idle, so compaction's
 * usage and duration never fold into it; but history rebuild has no idle signal, so that round
 * still looks open — compaction's Token, cost, and elapsed time would get folded wholesale into
 * the previous round. The symptom: the same reply's stats look fine at first, then after a
 * reload they flip from "260 tokens · $0.0012 · 401ms" to "510 · $0.0020 · 1.7s".
 *
 * The unit test (stream-model) locks down the message sequence, but it can't lock down whether
 * a real `/compact` actually emits compaction_begin.reason === manual — that's exactly what the
 * frontend relies on to decide "compaction is outside the round," so this is covered end-to-end
 * here. Compaction is deliberately delayed by 3 seconds (the user reads the reply, then remembers
 * to compact): if that gap were counted, the elapsed time would jump from hundreds of
 * milliseconds to over 3 seconds.
 */
test("manual /compact between turns: reloading must not fold the compaction into the previous turn", async ({
  page,
}) => {
  const U2 = "manualcompact";
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
          // Window large enough that compaction only ever triggers manually via /compact.
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
  await ta.fill("帮我配置 @theme");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("命令已执行完成，结果符合预期。")).toBeVisible();

  // The whole stats line is transparent by default, but innerText still reads fine (no need to hover).
  const statsText = async () =>
    (await page.getByRole("button", { name: "复制回复" }).first().locator("xpath=..").innerText())
      .replace(/\n/g, " ")
      .trim();
  const costOf = (t) => t.match(/\$[\d.]+/)?.[0] ?? null;
  const elapsedMsOf = (t) => {
    const hit = [...t.matchAll(/(\d+(?:\.\d+)?)(ms|s)(?![\w/])/g)].at(-1);
    return hit ? Number(hit[1]) * (hit[2] === "s" ? 1000 : 1) : null;
  };

  const live = await statsText();
  expect(costOf(live), `统计行应有成本：${live}`).not.toBeNull();
  expect(elapsedMsOf(live)).toBeLessThan(1500);

  // The user reads the reply, then 3 seconds later remembers to compact.
  await page.waitForTimeout(3000);
  await ta.fill("/compact");
  await ta.press("Enter");
  await expect(page.getByText(/\[压缩\]/)).toBeVisible();
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
  expect(await statsText(), "实时流里上一轮早已收口，压缩不该改动它").toBe(live);

  await page.reload();
  await ta.waitFor();
  await expect(page.getByText("命令已执行完成，结果符合预期。")).toBeVisible();
  const rebuilt = await statsText();
  // Cost is derived from Token counts: if compaction's usage were folded in, cost would double out of nowhere.
  expect(costOf(rebuilt), `刷新前后成本必须一致（前：${live}｜后：${rebuilt}）`).toBe(costOf(live));
  // Elapsed time should include neither the 3-second thinking gap nor compaction itself.
  expect(elapsedMsOf(rebuilt), `刷新后用时不得吃进压缩（${rebuilt}）`).toBeLessThan(1500);
});
