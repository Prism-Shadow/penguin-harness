/**
 * Scrolling up while a reply streams: the transcript must not bounce back down.
 *
 * In each theme (Primer shows each commit at once, so the commit snaps the view; Frost and
 * Console grow the reply every reveal frame, so the resize observer snaps it):
 *
 * - Given a reply streaming a paragraph every 50ms with the view following the bottom, and a
 *   renderer slowed four times, when the reader wheels up from the bottom in small steps, the
 *   view never moves back down: no snap to the bottom lands after the browser was free to put
 *   the gesture on screen, no frame shows a snap composed with the gesture, and once the
 *   gesture has moved the text down no frame moves it back up.
 * - For the second after the gesture, while the reply keeps growing below, the text on screen
 *   does not move at all: following stays off until the reader scrolls back down.
 *
 * The page records, while armed, every animation frame (the transcript's scrollTop and where a
 * paragraph that was on screen when the gesture began sits in the viewport), every wheel event
 * and every programmatic scrollTop write on the transcript. One line per gesture is printed
 * with the prefix BOUNCE (BOUNCE_DUMP=1 adds the raw recording); BOUNCE_GESTURES overrides the
 * number of gestures per theme, 6 by default.
 *
 * The browser scrolls a wheel the page cannot cancel on the compositor at once and tells the
 * page later; one the page can cancel waits until the page has handled it. A snap is late when
 * it raises scrollTop after that point — the first wheel's creation, or its handling — since
 * it then lands on a gesture the screen may already show. These are what the page can observe:
 * the compositor's own frames are not visible to it.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin, login } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const USER = "scrollbounce";
const PASSWORD = "password123";
const GESTURES = Number(process.env.BOUNCE_GESTURES ?? 6);
/** The three themes: stored id → name. */
const THEMES = { github: "Primer", modern: "Frost", geek: "Console" };
/** The transcript's scroller. */
const SCROLLER = '[data-find-region="conversation"]';

test.use({ viewport: { width: 1280, height: 720 } });

let projectId;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await provisionAndLogin(page.request, USER, PASSWORD);
  projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0].projectId;
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
  expect(models.ok(), await models.text()).toBeTruthy();
  await page.close();
});

/** Page side: the recorder, installed once the transcript has mounted. */
function installRecorder(selector) {
  const el = document.querySelector(selector);
  const native = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  const rec = { on: false, frames: [], wheels: [], writes: [] };
  /** Paragraph identities, so a frame can say where the same text sat in the one before. */
  const ids = new WeakMap();
  let nextId = 0;
  /** [id, top] of each paragraph on screen: what the reader sees, wherever the anchor is. */
  const onScreen = () => {
    const box = el.getBoundingClientRect();
    const ps = el.querySelectorAll("p");
    const seen = [];
    for (let i = Math.max(0, ps.length - 60); i < ps.length; i += 1) {
      const r = ps[i].getBoundingClientRect();
      if (r.bottom <= box.top || r.top >= box.bottom) continue;
      if (!ids.has(ps[i])) ids.set(ps[i], (nextId += 1));
      seen.push([ids.get(ps[i]), r.top]);
    }
    return seen;
  };
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get() {
      return native.get.call(this);
    },
    set(value) {
      const before = native.get.call(this);
      native.set.call(this, value);
      if (rec.on) rec.writes.push({ t: performance.now(), before, after: native.get.call(this) });
    },
  });
  window.addEventListener(
    "wheel",
    (e) => {
      if (!rec.on) return;
      rec.wheels.push({ t: performance.now(), ts: e.timeStamp, cancelable: e.cancelable });
    },
    { capture: true, passive: true },
  );
  const frame = () => {
    if (rec.on) {
      rec.frames.push({
        t: performance.now(),
        top: native.get.call(el),
        h: el.scrollHeight,
        seen: onScreen(),
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__bounce = {
    start() {
      rec.frames = [];
      rec.wheels = [];
      rec.writes = [];
      rec.on = true;
    },
    stop() {
      rec.on = false;
      return { frames: rec.frames, wheels: rec.wheels, writes: rec.writes };
    },
    toBottom() {
      el.scrollTop = el.scrollHeight;
    },
    following(minHeight) {
      return (
        el.scrollHeight > minHeight && el.scrollHeight - native.get.call(el) - el.clientHeight <= 1
      );
    },
    height() {
      return el.scrollHeight;
    },
  };
}

/**
 * The bounces in one gesture's recording, by kind (see the header), and what the gesture did;
 * `stillFrom` starts the stay-put window.
 */
function analyze({ frames, wheels, writes }, stillFrom) {
  const first = wheels[0];
  if (first === undefined) return { bounces: [{ kind: "no-wheel" }] };
  const freeAt = first.cancelable ? first.t : first.ts;
  const rising = writes.filter((w) => w.after > w.before + 0.5);
  const bounces = rising
    .filter((w) => w.t >= freeAt)
    .map((w) => ({
      kind: "late-snap",
      t: Math.round(w.t - first.ts),
      from: w.before,
      to: w.after,
    }));
  /** How far the text on screen moved down since the frame before (the median paragraph). */
  const moved = (prev, f) => {
    const was = new Map(prev.seen);
    const d = f.seen.filter(([id]) => was.has(id)).map(([id, top]) => top - was.get(id));
    if (d.length === 0) return 0;
    d.sort((x, y) => x - y);
    return d[Math.floor(d.length / 2)];
  };
  let movedDown = false;
  let travel = 0;
  const path = [];
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1];
    const f = frames[i];
    if (f.t < first.ts) continue;
    const snap = rising.filter((w) => w.t >= prev.t && w.t <= f.t).at(-1);
    if (f.top > prev.top + 0.5 && snap !== undefined && f.top < snap.after - 0.5) {
      bounces.push({
        kind: "composed",
        t: Math.round(f.t - first.ts),
        snap: snap.after,
        to: f.top,
      });
    }
    const d = moved(prev, f);
    travel += d;
    path.push({ t: f.t, travel });
    if (d > 0.5) movedDown = true;
    else if (movedDown && d < -0.5) {
      bounces.push({ kind: "after-up", t: Math.round(f.t - first.ts), by: -d });
    }
  }
  const still = path.filter((p) => p.t >= stillFrom).map((p) => p.travel);
  const tail = frames.filter((f) => f.t >= stillFrom);
  return {
    bounces,
    firstWheelCancelable: first.cancelable,
    wheelLatency: Math.round(first.t - first.ts),
    textMovedDown: Math.round(still[0] ?? travel),
    stillDrift: still.length > 0 ? Math.max(...still) - Math.min(...still) : null,
    grewWhileStill: tail.length > 0 ? tail[tail.length - 1].h - tail[0].h : 0,
  };
}

/** Waits until `want` replies have shown their paragraph `n`. */
const paragraphShown = (page, n, want) =>
  page.waitForFunction(
    ([selector, n, want]) =>
      [...document.querySelectorAll(`${selector} p`)].filter((p) =>
        p.textContent.startsWith(`Paragraph ${n}.`),
      ).length >= want,
    [SCROLLER, n, want],
    { polling: 100, timeout: 30_000 },
  );

for (const [theme, name] of Object.entries(THEMES)) {
  test(`${name}: wheeling up while a reply streams never moves the view back down`, async ({
    page,
  }) => {
    test.setTimeout(60_000 + GESTURES * 20_000);
    await login(page.request, USER, PASSWORD);
    // The theme is the account's: every test signs in as the same user (account-prefs.mjs).
    await setAccountPrefs(page.request, { themeId: theme });
    const created = await page.request.post(
      `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
      { data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" } },
    );
    expect(created.ok(), await created.text()).toBeTruthy();
    const sessionId = (await created.json()).session.sessionId;
    await page.goto(`/chat/${sessionId}`);
    const input = page.getByPlaceholder(/输入消息/);
    await input.waitFor();

    const cdp = await page.context().newCDPSession(page);
    const results = [];
    for (let i = 1; i <= GESTURES; i += 1) {
      await input.fill(`scroll bounce test ${i}`);
      await page.keyboard.press("Enter");
      await paragraphShown(page, 6, i);
      if (i === 1) {
        // The transcript mounts with the conversation's first message.
        await page.evaluate(installRecorder, SCROLLER);
        const box = await page.locator(SCROLLER).boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      }
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      // Following: put the view at the bottom and watch it stay there while the reply grows.
      // A commit can land between the jump and its scroll event and leave the view short of
      // the bottom, not following; the jump is then simply taken again.
      await expect
        .poll(
          async () => {
            await page.evaluate(() => window.__bounce.toBottom());
            const h0 = await page.evaluate(() => window.__bounce.height());
            return page
              .waitForFunction((h) => window.__bounce.following(h + 200), h0, {
                polling: "raf",
                timeout: 1500,
              })
              .then(
                () => true,
                () => false,
              );
          },
          { timeout: 10_000, intervals: [0] },
        )
        .toBe(true);
      await page.evaluate(() => window.__bounce.start());
      // Following was just confirmed on a commit, so start each gesture at a different point of
      // the commit cycle (a golden-ratio walk over 0–140ms): the race is with the next commit.
      await page.waitForTimeout(100 + Math.round(((i * 0.618034) % 1) * 140));
      for (let k = 0; k < 10; k += 1) {
        await page.mouse.wheel(0, -50);
        await page.waitForTimeout(30);
      }
      await page.waitForTimeout(400);
      const stillFrom = await page.evaluate(() => performance.now());
      await page.waitForTimeout(1000);
      const recording = await page.evaluate(() => window.__bounce.stop());
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const r = { theme: name, gesture: i, ...analyze(recording, stillFrom) };
      results.push(r);
      console.log(`BOUNCE ${JSON.stringify(r)}`);
      if (process.env.BOUNCE_DUMP) console.log(`BOUNCE-DUMP ${JSON.stringify(recording)}`);
      // The reply finishes before the next one is sent.
      await paragraphShown(page, 80, i);
      await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, {
        timeout: 30_000,
      });
    }

    const bounced = results.filter((r) => r.bounces.length > 0).length;
    console.log(`BOUNCE-SUMMARY ${name}: ${bounced}/${results.length} gestures bounced`);
    for (const r of results) {
      expect.soft(r.bounces, `gesture ${r.gesture}: bounced`).toEqual([]);
      expect
        .soft(r.textMovedDown, `gesture ${r.gesture}: the wheel scrolled up`)
        .toBeGreaterThan(100);
      expect
        .soft(r.stillDrift, `gesture ${r.gesture}: moved after the gesture`)
        .toBeLessThanOrEqual(0.5);
    }
    // The stay-put window means something only while the reply still grows below it.
    expect(results.filter((r) => r.grewWhileStill > 0).length).toBeGreaterThanOrEqual(
      Math.ceil(results.length / 2),
    );
  });
}
