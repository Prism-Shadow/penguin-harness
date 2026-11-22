// Previewing a starter writes nothing. Creating it saves an independent, editable presentation
// that can be reopened from Recent and exported with the text and speaker notes intact.
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
const BASE = process.env.BASE_URL;

test("preview a template, create a named copy and reopen it from Recent", async ({ page }) => {
  await provisionAndLogin(page.request, "bentotemplatesuser", "password123");
  const { projects } = await (await page.request.get(BASE + "/api/projects")).json();
  const project = projects[0].projectId;
  const agent = BASE + "/api/projects/" + project + "/agents/default_agent";
  const installed = await page.request.post(agent + "/plugins", {
    data: { names: ["use-bento-slides"] },
  });
  expect(installed.ok(), await installed.text()).toBeTruthy();
  const decks = agent + "/workbenches/slides/api/decks";
  const list = async () => (await (await page.request.get(decks)).json()).decks;
  await page.goto(BASE + "/app/" + project + "/default_agent/slides/main");
  const app = page.frameLocator("iframe[src*='/workbenches/slides/ui/']:visible");
  const editor = app.frameLocator("#editor");
  const name = "Autumn pilot <A & B>";
  await app.locator('[data-template="retro"]').click();
  await app.locator("#preview-next").click();
  await expect(app.locator("#preview-sheet")).toContainText(/pilot tested|试用了什么/);
  await app.locator("#create-cancel").click();
  expect(await list()).toHaveLength(0);
  await app.locator('[data-template="brief"]').click();
  await app.locator("#create-name").fill(name);
  await expect(app.locator("#preview-sheet")).toContainText(name);
  await app.locator("#create-form [type=submit]").click();
  await expect(editor.locator(".ed-thumb")).toHaveCount(4);
  const opened = (await list()).find((deck) => deck.title === name);
  const read = async () =>
    JSON.parse((await (await page.request.get(decks + "/" + opened.id)).json()).text);
  const original = await read();
  expect(original.slides[0].elements.find((el) => el.role === "title").html).toBe(
    "Autumn pilot &lt;A &amp; B&gt;",
  );
  const changed = "Revised pilot";
  await editor.locator(".ed-title").fill(changed);
  await editor.locator(".ed-title").press("Control+s");
  await expect.poll(async () => (await read()).title).toBe(changed);
  await app.locator("#show-decks").click();
  await app.locator("[data-open-deck]").filter({ hasText: changed }).click();
  await expect(editor.locator(".ed-thumb")).toHaveCount(4);
  await app.locator("#file-button").click();
  const exporting = page.waitForEvent("download");
  await app.locator("#pptx").click();
  expect((await exporting).suggestedFilename()).toMatch(/\.pptx$/);
});
