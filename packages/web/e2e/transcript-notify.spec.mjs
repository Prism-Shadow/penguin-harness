/**
 * The open Session's announcements, end to end in the real app: a question card that lands while
 * the window is away raises one system notification for the whole message (naming the Session and
 * how many questions are waiting), clicking it comes back and flashes the card that asked; a card
 * the user watched arrive stays silent — also on a later blur; and a dropped request's reconnect
 * ladder is announced once, with the attempt it is waiting on.
 *
 * The run is injected through `POST /api/sessions/:id/tasks` rather than the composer: the window
 * has to be away *before* the arrival, and a headless click cannot compose a message into a
 * window that is pretending not to be there. That is also how a scheduled task or another tab
 * would start one, so nothing about the path being exercised is special to the test.
 *
 * Two doubles are installed before the app loads (see `armNotifications`):
 *   - `Notification`, so the announcement can be read instead of raised. Only the constructor,
 *     the live `permission` read and `requestPermission` are replaced — the code deciding
 *     *whether* to announce is the app's own.
 *   - The window's away state. Headless Chromium keeps every page of a context visible and
 *     focused (a second page brought to front does not hide the first — verified), so the one
 *     condition a headless run cannot produce is stubbed: `document.hidden`, `visibilityState`
 *     and `document.hasFocus()` answer as a window that is not being watched while
 *     `window.__away` is true. Everything downstream of that answer is real.
 *
 * Mock branches: "ask card test" (the cards) and "notify retry test" (a retryable 429 on the
 * run's first two attempts, then an answer) in mock-llm.mjs.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const P = "password123";
/** The announcement titles, verbatim from strings.ts (`S.notify`) — the locale the suite runs in. */
const ASK_TITLE = "有问题等待你的回答";
const RETRY_TITLE = "请求失败，正在重试";

/**
 * Installs the doubles and turns the preference on, and has to run before the app's own bundle:
 * the preference is read by the running app, and both the permission read and the window-state
 * read are live (lib/notification-pref.ts, lib/system-notify.ts), so a stub in place before the
 * first render is enough for the rest of the page's life.
 */
async function armNotifications(page) {
  await page.addInitScript(() => {
    window.__away = false;
    Object.defineProperty(document, "hidden", { get: () => window.__away });
    Object.defineProperty(document, "visibilityState", {
      get: () => (window.__away ? "hidden" : "visible"),
    });
    document.hasFocus = () => !window.__away;

    window.__notices = [];
    class RecordingNotification {
      static permission = "granted";
      static requestPermission() {
        return Promise.resolve("granted");
      }
      constructor(title, options = {}) {
        this.title = title;
        this.body = options.body ?? "";
        this.tag = options.tag ?? "";
        this.onclick = null;
        this.closed = false;
        window.__notices.push(this);
      }
      close() {
        this.closed = true;
      }
    }
    window.Notification = RecordingNotification;
    localStorage.setItem("penguin.notifications", "1");
  });
}

/** The announcements raised so far, in order, as plain data. */
function readNotices(page) {
  return page.evaluate(() =>
    window.__notices.map((n) => ({ title: n.title, body: n.body, tag: n.tag })),
  );
}

/** The announcements raised so far carrying `tag` (a Session's own doorbell; see system-notify.ts). */
async function noticesTagged(page, tag) {
  return (await readNotices(page)).filter((n) => n.tag === tag);
}

/** A Session on the mock model, with the notification doubles armed on the page watching it. */
async function openSession(page, user) {
  await provisionAndLogin(page.request, user, P);
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
  await armNotifications(page);
  // The run is injected only once the transcript has finished loading: the trackers reset while
  // it loads and baseline the first complete snapshot, so a run started mid-load would be read as
  // "where the conversation already was" rather than as an arrival (see ask-notify.ts).
  const history = page.waitForResponse((r) => r.url().includes("/messages") && r.status() === 200);
  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).waitFor();
  await history;
  // …and once the page has settled after it: `stream.loading` covers more than the history
  // fetch, and a run injected into that window would be baselined as the load's own content.
  await page.waitForTimeout(1000);
  return sessionId;
}

/** Starts a run through the API, the way a scheduled task or another tab would. */
async function runViaApi(page, sessionId, text) {
  const res = await page.request.post(`${BASE}/api/sessions/${sessionId}/tasks`, {
    data: { input: [{ type: "text", text }] },
  });
  expect(res.ok(), "post task").toBeTruthy();
}

test("a question card arriving while the window is away raises one notification", async ({
  page,
}) => {
  const sessionId = await openSession(page, "notifyuser");
  await page.evaluate(() => {
    window.__away = true;
  });
  await runViaApi(page, sessionId, "ask card test");

  // One message, two cards, ONE announcement — the message is the event, not each card.
  const tag = `penguin-ask-${sessionId}`;
  await expect
    .poll(async () => (await noticesTagged(page, tag)).length, { timeout: 30_000 })
    .toBe(1);
  const [notice] = await noticesTagged(page, tag);
  expect(notice.title).toBe(ASK_TITLE);
  expect(notice.body).toContain("有 2 个问题待回答");

  // The cards really are unanswered in the transcript — the announcement is not the only trace.
  await expect(page.locator('[data-ask-card="pending"]')).toHaveCount(2, { timeout: 30_000 });

  // Clicking the notification is the app's own handler: it comes back to the Session and points
  // at the card that asked (revealPendingAskCard's flash).
  await page.evaluate(() => window.__notices[0].onclick());
  await expect(page.locator(".ask-card-flash")).toHaveCount(1);
  expect(new URL(page.url()).pathname).toBe(`/chat/${sessionId}`);
});

test("a card the user watched arrive is consumed, not announced later", async ({ page }) => {
  const sessionId = await openSession(page, "notifywatchuser");
  await runViaApi(page, sessionId, "ask card test");
  await expect(page.locator('[data-ask-card="pending"]')).toHaveCount(2, { timeout: 30_000 });

  // Nothing at all was raised while the window was being watched — the card is the point here,
  // but the gate is shared, so the run's completion stayed quiet too.
  const tag = `penguin-ask-${sessionId}`;
  expect(await readNotices(page)).toEqual([]);
  await page.evaluate(() => {
    window.__away = true;
  });
  await page.waitForTimeout(700);
  // A later blur does not replay what the window already showed: the arrival was consumed at
  // sight (see ask-notify.ts). A completion notice may legitimately land in that same window —
  // the run does finish while it is away — so this asks about the card's own doorbell.
  expect(await noticesTagged(page, tag)).toEqual([]);
});

test("a retry ladder starting to wait while the window is away is announced once", async ({
  page,
}) => {
  const sessionId = await openSession(page, "notifyretryuser");
  await page.evaluate(() => {
    window.__away = true;
  });
  await runViaApi(page, sessionId, "notify retry test");

  // The run's early attempts fail retryably, so the engine reconnects; the announcement names
  // the attempt it is waiting on rather than the failure that caused it. Which attempt is
  // current when the first snapshot sees a waiting row is a repaint race (the mock fails twice
  // back to back), so the ordinal is read loosely — the one-incident rule below is what the
  // announcement is actually asserting.
  const tag = `penguin-retry-${sessionId}`;
  await expect
    .poll(async () => (await noticesTagged(page, tag)).length, { timeout: 30_000 })
    .toBe(1);
  const [notice] = await noticesTagged(page, tag);
  expect(notice.title).toBe(RETRY_TITLE);
  expect(notice.body).toMatch(/第 [12] 次重试/);

  // The ladder reuses its item as it climbs, so the later attempts are silent — one incident,
  // one doorbell — and the run ends on the mock's third attempt.
  await expect(page.getByText("Recovered after the retries.")).toBeVisible({
    timeout: 30_000,
  });
  expect(await noticesTagged(page, tag)).toHaveLength(1);
});
