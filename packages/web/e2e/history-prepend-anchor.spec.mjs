/**
 * Prepend scroll anchoring on main (unit-windowed history: TAIL_UNITS = OLDER_UNITS = 20).
 *
 * One Session is driven to 45 exchanges, so a fresh open loads the newest 20 turns and a
 * scroll to the top prepends the previous 20. For each starting scroll offset the spec
 * records where a visible prompt sits in the viewport before the prepend and after it
 * lands, plus a per-frame trace of that prompt's position in between. It reports numbers
 * (lines prefixed ANCHOR) and asserts the reader stays within 2px.
 *
 * START_TOPS (env, comma separated) overrides the starting offsets; default "0,150,0,150".
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "anchoruser";
const P = "password123";
const TURNS = 45;
const STARTS = (process.env.START_TOPS ?? "0,150,0,150").split(",").map(Number);

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

const prompts = (page) => page.locator("[data-outline-anchor]");

test("a prepended window leaves the reader where they were (measured)", async ({ page }) => {
  test.setTimeout(600_000);
  const sessionId = await setup(page);
  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  const send = sender(page, ta);
  for (let n = 1; n <= TURNS; n += 1) await send(`第 ${n} 问`, n);

  const results = [];
  for (const startTop of STARTS) {
    const requests = [];
    const onReq = (r) => {
      if (r.url().includes("/messages")) requests.push(r.url().replace(BASE, ""));
    };
    page.on("request", onReq);
    await page.reload();
    await expect(prompts(page).first()).toBeVisible();
    await expect(page.getByText(`第 ${TURNS} 问`, { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(1500);
    const opened = await prompts(page).count();
    expect(opened, "opens on a window, not the whole transcript").toBeLessThan(TURNS);

    // Scroll, pick the first prompt inside the viewport, measure it and start a per-frame
    // trace in ONE synchronous evaluation: the fetch the scroll triggers is asynchronous,
    // so nothing can land between the scroll and the first measurement.
    const before = await page.evaluate((top) => {
      const first = document.querySelector("[data-outline-anchor]");
      const c = first.closest(".overflow-y-auto");
      c.scrollTop = top;
      const ct = c.getBoundingClientRect().top;
      const node = [...document.querySelectorAll("[data-outline-anchor]")].find(
        (n) => n.getBoundingClientRect().top >= ct,
      );
      const key = node.getAttribute("data-outline-anchor");
      const trace = [];
      window.__anchorTrace = trace;
      window.__anchorStop = false;
      const t0 = performance.now();
      const tick = () => {
        const n = document.querySelector(`[data-outline-anchor="${key}"]`);
        trace.push({
          t: Math.round(performance.now() - t0),
          top: n ? Math.round(n.getBoundingClientRect().top * 10) / 10 : null,
          scrollTop: Math.round(c.scrollTop * 10) / 10,
          scrollHeight: c.scrollHeight,
          count: document.querySelectorAll("[data-outline-anchor]").length,
        });
        if (!window.__anchorStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return {
        key,
        top: node.getBoundingClientRect().top,
        scrollTop: c.scrollTop,
        scrollHeight: c.scrollHeight,
        clientHeight: c.clientHeight,
        text: node.textContent.slice(0, 20),
      };
    }, startTop);

    await expect.poll(() => prompts(page).count(), { timeout: 20000 }).toBeGreaterThan(opened);
    const measure = () =>
      page.evaluate((key) => {
        const n = document.querySelector(`[data-outline-anchor="${key}"]`);
        const c = n.closest(".overflow-y-auto");
        return {
          top: n.getBoundingClientRect().top,
          scrollTop: c.scrollTop,
          scrollHeight: c.scrollHeight,
          count: document.querySelectorAll("[data-outline-anchor]").length,
        };
      }, before.key);
    const landed = await measure();
    await page.waitForTimeout(1000);
    const settled = await measure();
    const trace = await page.evaluate(() => {
      window.__anchorStop = true;
      return window.__anchorTrace;
    });
    page.off("request", onReq);
    // Compress the trace to the frames where anything changed.
    const changes = trace.filter(
      (f, i) =>
        i === 0 ||
        f.top !== trace[i - 1].top ||
        f.scrollTop !== trace[i - 1].scrollTop ||
        f.scrollHeight !== trace[i - 1].scrollHeight ||
        f.count !== trace[i - 1].count,
    );
    const r = {
      startTop,
      opened,
      prompt: before.text,
      before,
      landed,
      settled,
      displacementLanded: Math.round((landed.top - before.top) * 10) / 10,
      displacementSettled: Math.round((settled.top - before.top) * 10) / 10,
      grew: settled.scrollHeight - before.scrollHeight,
      requests,
      changes,
    };
    results.push(r);
    console.log(`ANCHOR ${JSON.stringify(r)}`);
  }
  for (const r of results) {
    console.log(
      `ANCHOR-SUMMARY start=${r.startTop} opened=${r.opened} loaded=${r.settled.count} ` +
        `grew=${r.grew}px displacement(landed)=${r.displacementLanded}px ` +
        `displacement(settled)=${r.displacementSettled}px scrollTop ${r.before.scrollTop} -> ${r.settled.scrollTop}`,
    );
  }
  for (const r of results) {
    expect
      .soft(Math.abs(r.displacementSettled), `start ${r.startTop}: reader displaced`)
      .toBeLessThanOrEqual(2);
  }
});
