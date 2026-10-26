/**
 * The Files panel's Markdown preview and its title-row outline (#1154's promise: a Markdown
 * reader with an outline and an in-page find, its outline and find icons in the title row).
 *
 * - A document with two or more headings offers the outline from the title row's「目录」button;
 *   the popover lists the headings in document order, and a chosen row scrolls the preview's
 *   own box to its heading. The popover closes on the choice, so the proof is the scroll and
 *   the heading it lands on — not an attribute on a row that has just unmounted.
 * - A document with fewer than two headings offers no outline at all: the「目录」button is
 *   not there, and neither is the popover.
 * - The outline round-trip leaves the in-page find untouched: the preview's Ctrl+F still
 *   counts a unique marker (`1/1`), still paints its hit through the CSS Custom Highlight
 *   API (`penguin-find-current` in `CSS.highlights`), and still closes on Escape without the
 *   reader losing its place — the find bar's counter and highlight are the regression face
 *   the release QA round measured, so this spec keeps them.
 *
 * The files come from a Workspace directory the spec itself seeds (no LLM branch is needed:
 * the preview reads the file, not a reply). Standalone spec: it registers its own user
 * (which auto-provisions a default Project), mirroring files-folders.spec.mjs's shape so a
 * reader who knows one knows the other.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "filesmdoutline";
const P = "password123";

/** A Workspace directory of the test's own, named so its sidebar group can be found. */
function workspace(name, files) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-files-")), name);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function setUp(page, dir) {
  await provisionAndLogin(page.request, U, P);
  const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
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
  const res = await page.request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    { data: { workspace: dir } },
  );
  expect(res.ok(), "create session").toBeTruthy();
  return (await res.json()).session.sessionId;
}

/** The Files panel's preview: the dock's right-hand column over the seeded directory. */
async function openPreview(page, sid, fileName) {
  await page.goto(`${BASE}/chat/${sid}`);
  await page.getByPlaceholder(/输入消息/).waitFor();
  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-workspace").click();
  const dock = page.getByTestId("dock");
  await dock.locator(`[data-tree-path="${fileName}"]`).waitFor();
  await dock.locator(`[data-tree-path="${fileName}"]`).click();
  await dock.locator(".md-body").waitFor();
  return dock;
}

/** The outline's rows, wherever the outline stands. */
const outlineRows = (page) => page.locator('nav[aria-label="目录"] button');

/** The preview's own scroll box: the nearest overflow-auto ancestor of the rendered body. */
const previewScrollBox = (dock) =>
  dock
    .locator(".md-body")
    .first()
    .locator("xpath=ancestor::div[contains(@class,'overflow-auto')][1]");

/** The long body that makes the preview's own box scroll: each section several paragraphs. */
const LONG_BODY = Array.from({ length: 6 }, (_, i) =>
  [
    `The alpha section's ${i + 1} paragraph runs long enough to wrap inside the preview's`,
    "own box, so a heading a screen down has a place to scroll to and a chosen outline",
    "row moves the box rather than sitting at its top with nothing under it. The beta",
    "section's paragraphs do the same, and the find's marker rides none of them.",
  ].join(" "),
).join("\n\n");

const NOTES_MD = [
  "# S2 Handbook",
  "",
  LONG_BODY,
  "",
  "## Alpha Section",
  "",
  LONG_BODY,
  "",
  "### Alpha Detail",
  "",
  LONG_BODY,
  "",
  "## Beta Section",
  "",
  LONG_BODY,
  "",
  "The closing paragraph carries outlinefindmarker once, so the find's counter reads 1/1.",
].join("\n");

const TINY_MD = ["# A short note", "", "One heading alone offers no outline."].join("\n");

test("the outline opens from the title row and a chosen row scrolls the preview to its heading", async ({
  page,
}) => {
  const dir = workspace("outline", { "notes.md": NOTES_MD, "tiny.md": TINY_MD });
  const sid = await setUp(page, dir);
  const dock = await openPreview(page, sid, "notes.md");

  // The outline button is in the title row, and the popover lists the four headings in
  // document order: the H1, the first H2, the H3 under it, then the second H2.
  await dock.getByRole("button", { name: "目录" }).click();
  await outlineRows(page).first().waitFor();
  const rowsTexts = (await outlineRows(page).allInnerTexts()).map((t) => t.trim());
  expect(rowsTexts).toEqual(["S2 Handbook", "Alpha Section", "Alpha Detail", "Beta Section"]);

  // A chosen row (the third, the H3) scrolls the preview's own box to its heading.
  await outlineRows(page).nth(2).click();
  await expect(previewScrollBox(dock)).toBeVisible();
  const scrollTop = await previewScrollBox(dock).evaluate((el) => el.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  // The heading the row chose is on screen: the H3's own text, not the body around it.
  await expect(dock.getByText("Alpha Detail")).toBeVisible();

  // The chosen row stays current: reopening the outline marks it `aria-current`, so the
  // reader's active section is the one the row picked, not the one the scroll passed.
  await dock.getByRole("button", { name: "目录" }).click();
  await outlineRows(page).first().waitFor();
  await expect(outlineRows(page).nth(2)).toHaveAttribute("aria-current", "location");

  // Escape closes the popover and the outline goes with it: no outline rows remain.
  await page.keyboard.press("Escape");
  await expect(outlineRows(page)).toHaveCount(0);
});

test("a single-heading document offers no outline at all", async ({ page }) => {
  const dir = workspace("outline", { "tiny.md": TINY_MD });
  const sid = await setUp(page, dir);
  const dock = await openPreview(page, sid, "tiny.md");

  await expect(dock.getByRole("button", { name: "目录" })).toHaveCount(0);
  await expect(outlineRows(page)).toHaveCount(0);
});

test("the in-page find still counts and highlights after the outline round-trip", async ({
  page,
}) => {
  const dir = workspace("outline", { "notes.md": NOTES_MD });
  const sid = await setUp(page, dir);
  const dock = await openPreview(page, sid, "notes.md");

  // The outline round-trip first, so the find proves it survived the outline's state.
  await dock.getByRole("button", { name: "目录" }).click();
  await outlineRows(page).first().waitFor();
  await outlineRows(page).nth(1).click();
  await page.keyboard.press("Escape");
  await expect(outlineRows(page)).toHaveCount(0);

  // The find: the focus lands inside the preview, then the shortcut opens the bar.
  await dock.locator(".md-body").first().click();
  await page.keyboard.press("Control+f");
  const input = page.locator("input[placeholder*='查找']").first();
  await input.waitFor();
  await input.fill("outlinefindmarker");
  // The counter reads 1/1: the marker appears once, in the closing paragraph.
  await expect(dock.locator('[role="search"] [aria-live="polite"]')).toHaveText("1/1");

  // The hit is painted through the CSS Custom Highlight API, not a rewritten DOM.
  const highlights = await page.evaluate(() => [...CSS.highlights.keys()]);
  expect(highlights).toContain("penguin-find-current");

  // Escape closes the find and its paint, and the preview keeps its place.
  await page.keyboard.press("Escape");
  await expect(page.locator("input[placeholder*='查找']")).toHaveCount(0);
  // Both highlight keys leave the registry: the paint is gone, not half-cleared.
  const afterEscape = await page.evaluate(() => [...CSS.highlights.keys()]);
  expect(afterEscape.filter((k) => k.startsWith("penguin-find"))).toEqual([]);

  // The find reopens on the same marker and reads the same counter.
  await dock.locator(".md-body").first().click();
  await page.keyboard.press("Control+f");
  await input.fill("outlinefindmarker");
  await expect(dock.locator('[role="search"] [aria-live="polite"]')).toHaveText("1/1");
});
