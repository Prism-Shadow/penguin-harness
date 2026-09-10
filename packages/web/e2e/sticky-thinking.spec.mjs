/**
 * Stacked sticky rows over a LONG expanded thinking body. The existing sticky assertion
 * (outline.spec) reads a tool output, which scrolls inside its own max-h box, so the card
 * itself is short. A thinking body has no internal scroll: the card grows with the text
 * and the two pinned levels — group header flush at the scrollport top, the thinking row
 * right below it — must hold at every scroll position across the body. A reader must never
 * see body text painted ABOVE the pinned rows (the "DONE / Thinking" bars sitting in the
 * middle of the prose).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "stickyuser";
const P = "password123";

test.use({ viewport: { width: 1280, height: 720 } });

const REPLY = "Command finished";

async function setup(page, approvalMode = "allow-all") {
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
      data: { provider: "custom", modelId: "claude-4-8", approvalMode },
    })
  ).json();
  return res.session.sessionId;
}

/**
 * Walk the scrollport through the expanded thinking body in 150px steps. Wherever the card
 * spans the fold with body still to come, both bars must be pinned at the top and stacked,
 * and whatever is painted right above the row's top edge must be the header — never prose.
 */
async function walkBody(page, { settleMs = 0 } = {}) {
  const samples = await page.evaluate(async (settle) => {
    const container = document.querySelector("[data-outline-anchor]").closest(".overflow-y-auto");
    const head = document.querySelector("[data-group-header]");
    const card = head.parentElement;
    const rowBtn = [...document.querySelectorAll("button[aria-expanded]")].find((b) =>
      b.textContent.includes("思考"),
    );
    const body = rowBtn.nextElementSibling;
    const out = [];
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let top = card.offsetTop; top < card.offsetTop + card.offsetHeight; top += 150) {
      container.scrollTop = top;
      await raf();
      await raf();
      if (settle > 0) await wait(settle);
      const ct = container.getBoundingClientRect().top;
      const h = head.getBoundingClientRect();
      const r = rowBtn.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      if (c.top >= ct || b.bottom < ct + h.height + r.height + 8) continue;
      const probe = document.elementFromPoint(r.left + r.width / 2, r.top - 2);
      out.push({
        scrollTop: top,
        headDelta: h.top - ct,
        rowDelta: r.top - (h.top + h.height),
        aboveRowIsHeader: head.contains(probe),
      });
    }
    return out;
  }, settleMs);
  expect(samples.length).toBeGreaterThan(5);
  for (const s of samples) {
    expect(Math.abs(s.headDelta), `header at top (scrollTop=${s.scrollTop})`).toBeLessThan(2);
    expect(Math.abs(s.rowDelta), `row stacked (scrollTop=${s.scrollTop})`).toBeLessThan(2);
    expect(s.aboveRowIsHeader, `header above row (scrollTop=${s.scrollTop})`).toBeTruthy();
  }
}

test("group header and thinking row stay pinned across a long expanded thinking body", async ({
  page,
}) => {
  const sessionId = await setup(page);
  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("long thinking test");
  await page.keyboard.press("Enter");
  await page.waitForFunction((marker) => document.body.innerText.includes(marker), REPLY, {
    timeout: 60000,
  });

  // The turn is over: the group collapsed. Open it, then open the thinking row.
  const header = page.locator("[data-group-header]");
  await expect(header).toHaveCount(1);
  await header.click();
  const row = page.locator("button[aria-expanded]").filter({ hasText: "思考" }).first();
  await row.click();
  await expect(page.getByText("Step 120:")).toBeVisible();

  await walkBody(page);
});

test("the same holds while the group is still running, in dark mode and at phone width", async ({
  page,
}) => {
  // always-ask: the exec_command parks on approval, so the group stays Running with its
  // timer ticking (a re-render every second) while the finished thinking is read.
  const sessionId = await setup(page, "always-ask");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("long thinking test");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "允许" })).toBeVisible({ timeout: 60000 });
  await expect(page.locator("[data-group-header]").filter({ hasText: "运行中" })).toHaveCount(1);

  const row = page.locator("button[aria-expanded]").filter({ hasText: "思考" }).first();
  await row.click();
  await expect(page.getByText("Step 120:")).toBeVisible();
  // A second of settling per sample lets the ticking header re-render under the probe.
  await walkBody(page, { settleMs: 1100 });

  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(300);
  await walkBody(page);
});
