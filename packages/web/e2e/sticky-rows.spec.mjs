/**
 * The transcript's two sticky levels: a work group's head pins to the top of the transcript,
 * and the open row inside it pins right below the head, while what they head scrolls under them.
 *
 * - Given a settled work group with one tool call's output open, when the transcript is
 *   scrolled into that output, the group head sits flush at the top of the transcript, the tool
 *   row sits right below it, and the output's lines pass under both without showing through.
 * - Given the same conversation under a custom background image, the head and the row still
 *   pin, the lines under them still do not show through, and the pinned rows show the image
 *   rather than a painted strip.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin, login } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const USER = "stickyrows";
const PASSWORD = "password123";
const REPLY = "Command finished; the result looks as expected.";

test.use({ viewport: { width: 1280, height: 720 } });
test.describe.configure({ mode: "serial" });

let sessionId;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await provisionAndLogin(page.request, USER, PASSWORD);
  const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
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
  const created = await page.request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" } },
  );
  expect(created.ok(), await created.text()).toBeTruthy();
  sessionId = (await created.json()).session.sessionId;
  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByPlaceholder(/输入消息/).fill("sticky rows test");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText(REPLY)).toBeVisible({ timeout: 60_000 });
  await page.close();
});

/** Opens the conversation, its work group and the second tool call's output. */
async function openOutput(page) {
  await login(page.request, USER, PASSWORD);
  await page.goto(`/chat/${sessionId}`);
  const head = page.locator("[data-group-header]");
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  const toolRow = page.locator("button[aria-expanded]").filter({ hasText: "执行命令" }).nth(1);
  await toolRow.click();
  await expect(toolRow).toHaveAttribute("aria-expanded", "true");
  // Both folds have finished opening: nothing moves between the readings below.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-fold]:not([data-fold="settled"])').length === 0,
  );
  // The pointer rests away from the transcript, so no row shows its hover state.
  await page.mouse.move(0, 0);
  return toolRow;
}

/**
 * Scrolls the transcript so the open row's section starts `into` px above its top, and reads
 * where the head and the row stand against the transcript's top edge.
 */
function scrollInto(page, toolRow, into) {
  return toolRow.evaluate(async (button, into) => {
    const row = button.closest(".ui-activity");
    const head = document.querySelector("[data-group-header]");
    let scroller = head.parentElement;
    while (!/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    const top = () => scroller.getBoundingClientRect().top;
    const section = row.parentElement;
    scroller.scrollTop += section.getBoundingClientRect().top - top() + into;
    // Two frames: what a row paints while stuck is decided after the scroll, on the next frame.
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const h = head.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const s = section.getBoundingClientRect();
    return {
      headOffset: h.top - top(),
      rowOffset: r.top - h.bottom,
      sectionAbove: s.top < top(),
      sectionBelow: s.bottom - r.bottom,
      band: { x: h.left, y: h.top, width: h.width, height: r.bottom - h.top },
    };
  }, into);
}

/** Both levels pinned at two scroll positions, with the same pixels on them at both. */
async function expectPinnedAndOpaque(page, toolRow) {
  const first = await scrollInto(page, toolRow, 60);
  const second = await scrollInto(page, toolRow, 97);
  for (const at of [first, second]) {
    expect(at.sectionAbove).toBe(true);
    expect(at.sectionBelow).toBeGreaterThan(40);
    expect(Math.abs(at.headOffset)).toBeLessThan(1);
    expect(Math.abs(at.rowOffset)).toBeLessThan(1);
  }
  // Different lines of output lie under the band at the two positions: identical pixels mean
  // none of them shows through the pinned head or row.
  await scrollInto(page, toolRow, 60);
  const shotA = await page.screenshot({ clip: first.band });
  await scrollInto(page, toolRow, 97);
  const shotB = await page.screenshot({ clip: second.band });
  expect(shotA.equals(shotB)).toBe(true);
  return second;
}

test("the group head and the open tool row pin at the top while the output scrolls under them", async ({
  page,
}) => {
  const toolRow = await openOutput(page);
  await expectPinnedAndOpaque(page, toolRow);
});

test("under a custom background the rows still pin, hide what scrolls under them, and show the image", async ({
  page,
}) => {
  // A flat wallpaper at full strength: any area showing only the background has its colour.
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#3a7d5c";
    ctx.fillRect(0, 0, 8, 8);
    localStorage.setItem("penguin.background.image", canvas.toDataURL("image/png"));
    localStorage.setItem(
      "penguin.background.settings",
      JSON.stringify({ transparency: 0, mode: "tile", position: "left top" }),
    );
  });
  const toolRow = await openOutput(page);
  await expect(page.locator(".ui-shell[data-wallpaper]")).toHaveCount(1);
  const pinned = await expectPinnedAndOpaque(page, toolRow);
  // A strip of the pinned head past its words, and the same strip of the transcript's empty
  // margin beside the card: the head paints the background, not a strip of its own.
  const strip = { width: 24, height: 8 };
  const onHead = await page.screenshot({
    clip: { x: pinned.band.x + pinned.band.width * 0.7, y: pinned.band.y + 2, ...strip },
  });
  const inMargin = await page.screenshot({
    clip: { x: pinned.band.x - strip.width - 4, y: pinned.band.y + 2, ...strip },
  });
  expect(onHead.equals(inMargin)).toBe(true);
});
