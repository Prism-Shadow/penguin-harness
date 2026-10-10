/**
 * The sidebar's conversation rows never run past the list they sit in.
 *
 * Every group's rows are the body of a fold (the UI package's `Fold`), a one-row grid whose
 * implicit column is `auto`. With the body's minimum width left automatic, that column grew to
 * the widest row's min-content width, where a truncating title counts at its full text width:
 * one long title pushed every row of its group past the sidebar's edge, so the title never
 * truncated and the edge cut off each row's time (「4 小」) and the hovered row's actions.
 *
 * Seeded: the temporary workspace holding a long mixed CJK/Latin title beside a short one, and a
 * real Workspace holding a long title in the active list, in the Background folder (a
 * CLI-opened Session) and in the Archived folder. The browser clock runs 23 hours ahead, so
 * every row's time reads 「23 小时前」, the widest relative form.
 *
 * - In each theme, at the narrowest pinned sidebar (below the `lg` breakpoint), in each
 *   grouping (Workspace, Agent, time) with both folders open and the long row hovered: every
 *   row sits inside the list's content box, the list does not overflow sideways, the long
 *   titles truncate, and each row's time and hover actions stay inside its trailing slot.
 * - The same holds in the drawer on a 320 px phone.
 */
import { test, expect, request } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { login, provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
// One user per worker process: a failed test restarts the worker, which seeds again in its
// beforeAll, and a second seeding into the same user would show every row twice.
const U = `rowwidth${process.pid}`;
const P = "password123";
const LONG = "审查并安装 PenguinHarness 桌面端的发布流程，并核对签名与公证结果";
const LONG_BACKGROUND = "Background run that keeps going until every check has passed";
const LONG_ARCHIVED = "一个已经归档的对话，标题也很长 with a long English tail";
const REPORTED = "审查并安装 PenguinHaradadad";
const SHORT = "Nonsense in";
const LONG_TITLES = [LONG, LONG_BACKGROUND, LONG_ARCHIVED];

test.beforeAll(async () => {
  const ctx = await request.newContext();
  await provisionAndLogin(ctx, U, P);
  const projects = await (await ctx.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  const put = await ctx.put(`${BASE}/api/projects/${projectId}/models`, {
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
  // A real directory: a Workspace is validated by realpath and must exist.
  const workspace = await mkdtemp(join(tmpdir(), "penguin-rowwidth-"));
  const create = async (title, data = {}) => {
    const res = await ctx.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data,
    });
    expect(res.ok(), `create ${title}: ${await res.text()}`).toBeTruthy();
    const { session } = await res.json();
    const renamed = await ctx.patch(`${BASE}/api/sessions/${session.sessionId}`, {
      data: { title },
    });
    expect(renamed.ok(), `rename ${title}`).toBeTruthy();
    return session.sessionId;
  };
  await create(LONG, { workspace });
  await create(LONG_BACKGROUND, { workspace, source: "cli" });
  const archived = await create(LONG_ARCHIVED, { workspace });
  const archive = await ctx.patch(`${BASE}/api/sessions/${archived}`, {
    data: { archived: true },
  });
  expect(archive.ok(), "archive").toBeTruthy();
  // The report's pair, in the temporary workspace.
  await create(SHORT);
  await create(REPORTED);
  await ctx.dispose();
});

/** Opens the conversation list with the theme and grouping stored, the clock 23 hours ahead. */
async function openList(page, { theme, grouping, drawer = false }) {
  await login(page.request, U, P);
  await page.addInitScript(
    ([t, g]) => {
      localStorage.setItem("penguin.lang", "zh");
      localStorage.setItem("penguin.themeId", t);
      localStorage.setItem("penguin.sidebarGroupMode", g);
    },
    [theme, grouping],
  );
  await page.clock.setFixedTime(new Date(Date.now() + 23 * 3600_000));
  await page.goto(`${BASE}/chat`);
  if (drawer) await page.getByRole("button", { name: /^Session/ }).click();
  // Below md the pinned column is still in the document, hidden; the drawer holds the list.
  const rows = page.locator('[data-testid="session-row"]').filter({ visible: true });
  await expect(rows.filter({ hasText: REPORTED })).toBeVisible();
  // The folders mount closed; their rows are measured too.
  for (const folder of [/^后台会话/, /^已归档/]) {
    await page.getByRole("button", { name: folder, expanded: false }).click();
  }
  await expect(rows.filter({ hasText: LONG_BACKGROUND })).toBeVisible();
  await expect(rows.filter({ hasText: LONG_ARCHIVED })).toBeVisible();
  // Hovered, the long row shows its actions and starts its title's scroll reveal.
  await rows.filter({ hasText: LONG }).hover();
}

/**
 * Every rendered row against the list that scrolls it, in client pixels, and what is out of
 * place: the row past the list's content box, the slot past the row, the time or the hover
 * actions past the slot, a long title drawn whole rather than truncated.
 */
const misplacedRows = (page, longTitles) =>
  page.evaluate((longTitles) => {
    const EPS = 0.5;
    const inside = (inner, outer) =>
      inner.left >= outer.left - EPS && inner.right <= outer.right + EPS;
    const scroller = (el) => {
      for (let node = el.parentElement; node !== null; node = node.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
      }
      throw new Error("no scrolling ancestor");
    };
    const report = [];
    // Below md the pinned column's rows are in the document too, but not rendered.
    const buttons = [...document.querySelectorAll('[data-testid="session-row"]')].filter(
      (button) => button.getClientRects().length > 0,
    );
    for (const button of buttons) {
      const list = scroller(button);
      const style = getComputedStyle(list);
      const box = list.getBoundingClientRect();
      const content = {
        left: box.left + list.clientLeft + parseFloat(style.paddingLeft),
        right: box.left + list.clientLeft + list.clientWidth - parseFloat(style.paddingRight),
      };
      const row = button.parentElement.getBoundingClientRect();
      const slotEl = button.nextElementSibling;
      const slot = slotEl.getBoundingClientRect();
      const [actions, time] = [...slotEl.children].map((el) => el.getBoundingClientRect());
      const titleEl = button.querySelector(".truncate");
      const title = titleEl.textContent;
      const problems = [];
      // The clock runs 23 hours ahead, so the slot is checked against the widest relative time.
      if (slotEl.textContent !== "23 小时前") problems.push(`time reads "${slotEl.textContent}"`);
      if (list.scrollWidth > list.clientWidth)
        problems.push(`list overflows sideways (${list.scrollWidth} > ${list.clientWidth})`);
      if (!inside(row, content))
        problems.push(
          `row ${row.left.toFixed(1)}..${row.right.toFixed(1)} outside ${content.left.toFixed(1)}..${content.right.toFixed(1)}`,
        );
      if (!inside(slot, row)) problems.push("trailing slot outside the row");
      if (!inside(actions, slot)) problems.push("hover actions outside the slot");
      if (time !== undefined && !inside(time, slot))
        problems.push(`time ${time.width.toFixed(1)} wide in a ${slot.width.toFixed(1)} slot`);
      if (longTitles.includes(title) && titleEl.scrollWidth <= titleEl.clientWidth)
        problems.push("long title not truncated");
      if (problems.length > 0) report.push({ title, problems });
    }
    return { rows: buttons.length, report };
  }, longTitles);

for (const theme of ["modern", "github", "geek"]) {
  test(`${theme}: at the narrowest pinned sidebar, every row of every grouping stays inside the list`, async ({
    page,
  }) => {
    // Below the lg breakpoint the pinned column takes its narrower width.
    await page.setViewportSize({ width: 800, height: 900 });
    for (const grouping of ["workspace", "agent", "time"]) {
      await openList(page, { theme, grouping });
      const { rows, report } = await misplacedRows(page, LONG_TITLES);
      expect(rows, `${grouping}: rows rendered`).toBeGreaterThanOrEqual(5);
      expect(report, `${theme} / ${grouping}`).toEqual([]);
    }
  });
}

test("in the phone's drawer, every row stays inside the list", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openList(page, { theme: "modern", grouping: "workspace", drawer: true });
  const { rows, report } = await misplacedRows(page, LONG_TITLES);
  expect(rows).toBeGreaterThanOrEqual(5);
  expect(report).toEqual([]);
});
