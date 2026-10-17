/**
 * The transcript's two sticky levels: a work group's head pins to the top of the transcript,
 * and the open row inside it pins right below the head, while what they head scrolls under them.
 *
 * In each theme (each paints its activity rows its own way):
 *
 * - Given a settled work group with one tool call's output open, when the transcript is
 *   scrolled into that output, the group head sits flush at the top of the transcript, the tool
 *   row sits right below it, and the output's lines pass under both without showing through.
 * - Given the same conversation under a custom background image, in light and dark mode, the
 *   head and the row still pin, the lines under them still do not show through, and the pinned
 *   rows show what the background shows in their place: the image, neither shifted nor
 *   rescaled, rather than a painted strip.
 */
import { writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { provisionAndLogin, login } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const USER = "stickyrows";
const PASSWORD = "password123";
const REPLY = "Command finished; the result looks as expected.";
/** The three themes: stored id → name. */
const THEMES = { github: "Primer", modern: "Frost", geek: "Console" };

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

/** Opens the conversation in a theme, then its work group and the second tool call's output. */
async function openOutput(page, theme) {
  await page.addInitScript((id) => localStorage.setItem("penguin.themeId", id), theme);
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
    scroller.scrollTop = Math.round(
      scroller.scrollTop + section.getBoundingClientRect().top - top() + into,
    );
    // Two frames: what a row paints while stuck is decided after the scroll, on the next frame.
    // And every face the text on screen asked for has arrived, so no glyph changes in between.
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    await document.fonts.ready;
    const h = head.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const s = section.getBoundingClientRect();
    return {
      headOffset: h.top - top(),
      rowOffset: r.top - h.bottom,
      sectionAbove: s.top < top(),
      sectionBelow: s.bottom - r.bottom,
      // The stretch of both rows past their words, two pixels in from the head's top edge and
      // the row's bottom: nothing of the rows' own is drawn there, so every pixel is either the
      // rows' ground or what shows through it. (A row pinned at a fractional offset
      // rasterizes its words, and the pixel rows its edges cross, a little differently from
      // one scroll position to the next.)
      band: {
        x: Math.round(h.left + h.width * 0.4),
        y: Math.ceil(h.top) + 2,
        width: Math.round(h.width * 0.45),
        height: Math.floor(r.bottom) - Math.ceil(h.top) - 4,
      },
    };
  }, into);
}

/** Hides or shows the whole transcript (its scroll container), leaving its place as it was. */
function showTranscript(toolRow, shown) {
  return toolRow.evaluate((button, shown) => {
    let scroller = button.parentElement;
    while (!/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    scroller.style.visibility = shown ? "" : "hidden";
  }, shown);
}

/** Both levels pinned at two scroll positions, with the same pixels on them at both. */
async function expectPinnedAndOpaque(page, toolRow) {
  const first = await scrollInto(page, toolRow, 60);
  const second = await scrollInto(page, toolRow, 97);
  for (const at of [first, second]) {
    expect(at.sectionAbove).toBe(true);
    expect(at.sectionBelow).toBeGreaterThan(40);
    expect(Math.abs(at.headOffset)).toBeLessThan(1);
    // Right below the head: never a gap the text could show through. A theme whose head is
    // taller than the eight spacing units the row's offset assumes tucks the row's top under
    // the head's bottom padding by a pixel or two.
    expect(at.rowOffset).toBeLessThan(0.5);
    expect(at.rowOffset).toBeGreaterThan(-4);
  }
  // Different lines of output lie under the band at the two positions: identical pixels mean
  // none of them shows through the pinned head or row.
  const band = second.band;
  await scrollInto(page, toolRow, 60);
  const shotA = await page.screenshot({ clip: band });
  await scrollInto(page, toolRow, 97);
  const shotB = await page.screenshot({ clip: band });
  writeFileSync(test.info().outputPath("band-60.png"), shotA);
  writeFileSync(test.info().outputPath("band-97.png"), shotB);
  expect(await pixelsApart(page, shotA, shotB), JSON.stringify({ first, second })).toEqual([]);
  return second;
}

/**
 * Where two same-sized screenshots differ by more than `tolerance` levels in a channel: up to
 * five `x,y` pixel positions, none when they match.
 */
function pixelsApart(page, a, b, tolerance = 0) {
  return page.evaluate(
    async ([tolerance, ...sources]) => {
      const [one, two] = await Promise.all(
        sources.map(async (src) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, image.width, image.height);
        }),
      );
      const apart = [];
      for (let i = 0; i < one.data.length && apart.length < 5; i += 4) {
        if ([0, 1, 2].some((c) => Math.abs(one.data[i + c] - two.data[i + c]) > tolerance)) {
          const at = i / 4;
          apart.push(`${at % one.width},${Math.floor(at / one.width)}`);
        }
      }
      return apart;
    },
    [tolerance, ...[a, b].map((png) => `data:image/png;base64,${png.toString("base64")}`)],
  );
}

for (const [theme, name] of Object.entries(THEMES)) {
  test(`${name}: the group head and the open tool row pin at the top while the output scrolls under them`, async ({
    page,
  }) => {
    const toolRow = await openOutput(page, theme);
    await expectPinnedAndOpaque(page, toolRow);
  });

  for (const mode of ["light", "dark"]) {
    test(`${name}, ${mode}: under a custom background the rows still pin, hide what scrolls under them, and show the image`, async ({
      page,
    }) => {
      // A wallpaper that changes smoothly and steeply everywhere (red follows x, green follows
      // y, a triangle wave of 8 levels a pixel), tiled at full strength from the window's
      // corner: a row showing it a few pixels off, rescaled or not at all differs by far more
      // than a row that is merely pinned at a fractional offset.
      await page.addInitScript((mode) => {
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        const image = ctx.createImageData(size, size);
        const wave = (v) => Math.round((Math.abs(v - size / 2) / (size / 2)) * 255);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            image.data.set([wave(x), wave(y), 128, 255], (y * size + x) * 4);
          }
        }
        ctx.putImageData(image, 0, 0);
        localStorage.setItem("penguin.theme", mode);
        localStorage.setItem("penguin.background.image", canvas.toDataURL("image/png"));
        localStorage.setItem(
          "penguin.background.settings",
          JSON.stringify({ transparency: 0, mode: "tile", position: "left top" }),
        );
      }, mode);
      const toolRow = await openOutput(page, theme);
      await expect(page.locator(".ui-shell[data-wallpaper]")).toHaveCount(1);
      const pinned = await expectPinnedAndOpaque(page, toolRow);
      // The pinned rows' stretch as it is, then the same stretch with the transcript hidden,
      // which leaves only what the window's background paints there: the rows show the
      // background itself, not a strip of their own and not the image shifted or rescaled.
      const onRows = await page.screenshot({ clip: pinned.band });
      await showTranscript(toolRow, false);
      const background = await page.screenshot({ clip: pinned.band });
      await showTranscript(toolRow, true);
      // A row pinned at a fractional offset is drawn up to a pixel off the grid: a few levels.
      expect(await pixelsApart(page, onRows, background, 24)).toEqual([]);
    });
  }
}
