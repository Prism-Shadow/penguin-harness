/**
 * The transcript's loaded run (windowed history, see stream-controller): a conversation
 * opens on its newest window plus one backfilled above it, scrolling up prepends further
 * windows while keeping the reader on the message they were on, the run sheds the live
 * tail once it outgrows its budget — so the DOM never holds the whole conversation — and
 * the jump button brings the live tail straight back.
 *
 * Standalone spec: registers its own user and drives one session to sixteen exchanges
 * (the mock answers the first with thinking + exec_command and the rest with plain text).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "windowuser";
const P = "password123";
const EXCHANGES = 16;

test.use({ viewport: { width: 1440, height: 860 } });

/** Reply completion marker: every mock turn-2 ends with this exact sentence. */
const REPLY = "Command finished";

async function setup(page) {
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
  const res = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();
  return res.session.sessionId;
}

/** Send a message and wait until the body carries `replies` completed mock replies. */
const sender = (page, ta) => async (text, replies) => {
  await ta.click();
  await ta.fill(text);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    ([marker, want]) => document.body.innerText.split(marker).length - 1 >= want,
    [REPLY, replies],
    { timeout: 60000 },
  );
};

/** The main stream's scroll container (the one holding the outline anchors). */
const scroller = (page) =>
  page
    .locator(".overflow-y-auto")
    .filter({ has: page.locator("[data-outline-anchor]") })
    .first();
/** Loaded user prompts: one outline anchor per top-level user message. */
const prompts = (page) => page.locator("[data-outline-anchor]");

test("opens on a window, backfills on scroll with the reader anchored, sheds the tail past the budget, jumps back", async ({
  page,
}) => {
  const sessionId = await setup(page);
  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  const send = sender(page, ta);
  for (let i = 1; i <= EXCHANGES; i += 1) await send(`第${i}问`, i);

  // A fresh open reads the newest window and one above it — a handful of exchanges, not
  // twenty. (Five messages per plain-text exchange, fifteen per window: three each.)
  await page.reload();
  await expect(prompts(page).first()).toBeVisible();
  await expect(page.getByText(`第${EXCHANGES}问`)).toBeVisible();
  await expect.poll(() => prompts(page).count()).toBeLessThan(EXCHANGES / 2);
  const opened = await prompts(page).count();
  expect(opened).toBeGreaterThanOrEqual(4);
  await expect(page.locator("[data-stream-detached]")).toHaveCount(0);

  // Scroll to the top: the previous window lands above, and the prompt that was at the
  // top stays exactly where it was on screen (the reader is anchored, not pushed down).
  const el = scroller(page);
  const key = await prompts(page).first().getAttribute("data-outline-anchor");
  // Scroll and measure in ONE synchronous evaluation: the fetch the scroll triggers is
  // asynchronous, so nothing can land between the two.
  const before = await page.evaluate((k) => {
    const node = document.querySelector(`[data-outline-anchor="${k}"]`);
    node.closest(".overflow-y-auto").scrollTop = 0;
    return node.getBoundingClientRect().top;
  }, key);
  await expect.poll(() => prompts(page).count()).toBeGreaterThan(opened);
  const after = await page
    .locator(`[data-outline-anchor="${key}"]`)
    .evaluate((n) => n.getBoundingClientRect().top);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  expect(await el.evaluate((c) => c.scrollTop)).toBeGreaterThan(0);

  // Keep going up: the run outgrows its budget and sheds the live tail, then the newest
  // windows — the DOM holds a bounded slice of the conversation, never all of it.
  let loaded = await prompts(page).count();
  for (let i = 0; i < 8; i += 1) {
    await el.evaluate((c) => {
      c.scrollTop = 0;
    });
    await page.waitForTimeout(400);
    const now = await prompts(page).count();
    expect(now).toBeLessThan(EXCHANGES);
    if ((await page.locator("[data-stream-detached]").count()) > 0) break;
    loaded = now;
  }
  await expect(page.locator("[data-stream-detached]")).toHaveCount(1);
  expect(await prompts(page).count()).toBeLessThan(EXCHANGES);
  await expect(page.getByText(`第${EXCHANGES}问`)).toHaveCount(0);
  void loaded;

  // The jump button is the way straight back: the tail re-attaches, the newest exchange
  // is on screen, and the run is back to an open's size.
  await page.getByRole("button", { name: "回到最新消息" }).click();
  await expect(page.locator("[data-stream-detached]")).toHaveCount(0);
  await expect(page.getByText(`第${EXCHANGES}问`)).toBeVisible();
  await expect.poll(() => prompts(page).count()).toBeLessThan(EXCHANGES / 2);

  // Scrolling down from a detached run walks back to the tail window by window and
  // re-attaches it without a jump.
  for (let i = 0; i < 6; i += 1) {
    await el.evaluate((c) => {
      c.scrollTop = 0;
    });
    await page.waitForTimeout(400);
    if ((await page.locator("[data-stream-detached]").count()) > 0) break;
  }
  await expect(page.locator("[data-stream-detached]")).toHaveCount(1);
  for (let i = 0; i < 10; i += 1) {
    await el.evaluate((c) => {
      c.scrollTop = c.scrollHeight;
    });
    await page.waitForTimeout(400);
    if ((await page.locator("[data-stream-detached]").count()) === 0) break;
  }
  await expect(page.locator("[data-stream-detached]")).toHaveCount(0);
  await el.evaluate((c) => {
    c.scrollTop = c.scrollHeight;
  });
  await expect(page.getByText(`第${EXCHANGES}问`)).toBeVisible();
  expect(await prompts(page).count()).toBeLessThan(EXCHANGES);
});
