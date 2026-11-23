/**
 * Given two imported books, the shelf finds the right title and remembers the passage
 * in each. Reopening the reader at a different width restores the paragraph and its notes.
 */
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { zip } from "./workbench-zip.mjs";

const base = process.env.BASE_URL;
const manifest = createRequire(import.meta.url).resolve(
  "@penguinharness/reading-desk/package.json",
);
const source = new URL("workbenches/reading/", pathToFileURL(manifest));

test("finds an imported book and resumes the annotated paragraph across screens", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "readingshelfuser", "password123");
  const projects = await (await page.request.get(base + "/api/projects")).json();
  const host =
    base + "/api/projects/" + projects.projects[0].projectId + "/agents/default_agent/workbenches";
  const filenames = [
    "package.json",
    "index.ts",
    ...(await readdir(new URL("ui/", source))).map((name) => "ui/" + name),
  ];
  const archive = zip(
    Object.fromEntries(
      await Promise.all(
        filenames.map(async (name) => ["reading/" + name, await readFile(new URL(name, source))]),
      ),
    ),
  );
  const installed = await page.request.post(host + "/archive", {
    data: { dataBase64: archive.toString("base64"), overwrite: true },
  });
  expect(installed.ok(), await installed.text()).toBeTruthy();
  await page.goto(host + "/reading/ui/index.html");
  const library = page.locator("#library");
  const pageTitle = page.locator("#book-title");
  const pageText = page.locator("#paragraphs > p");

  const importFile = async (file, title) => {
    await page.locator("#import-open").click();
    await page.locator("#file").setInputFiles(file);
    await expect(pageTitle).toHaveText(title);
  };
  const paragraphs = Array.from(
    { length: 65 },
    (_, i) =>
      "<p>Passage " + (i + 1) + ". " + "Reeds line the far bank of the river. ".repeat(8) + "</p>",
  ).join("");
  const ebook = zip({
    "META-INF/container.xml":
      '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
    "book.opf":
      '<package><metadata><title>River passages</title><creator>Lin Zhou</creator></metadata><manifest><item id="art" href="cover.png" media-type="image/png" properties="cover-image"/><item id="ch1" href="a.xhtml" media-type="application/xhtml+xml"/><item id="ch2" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/><itemref idref="ch2"/></spine></package>',
    "cover.png": Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO47mUsAAAAASUVORK5CYII=",
      "base64",
    ),
    "a.xhtml": "<html><body><h1>Morning</h1><p>The ferry arrived at noon.</p></body></html>",
    "b.xhtml": "<html><body><h1>Evening</h1>" + paragraphs + "</body></html>",
  });
  await expect(library).toBeVisible();
  await importFile(
    { name: "river.epub", mimeType: "application/epub+zip", buffer: ebook },
    "River passages",
  );
  await page.locator("#next").click();
  const passage = pageText.nth(29);
  await passage.evaluate((node) => {
    node.scrollIntoView({ block: "start" });
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.locator("#highlight").click();
  await expect(passage.locator("mark")).toBeVisible();
  await page.locator("#show-library").click();
  await expect
    .poll(() => page.locator("#resume-book img").evaluate((img) => img.naturalWidth))
    .toBe(1);
  await importFile(
    {
      name: "Garden sketches.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Morning\n\nThe gate was open."),
    },
    "Garden sketches",
  );
  await page.locator("#show-library").click();
  await page.locator("#book-search").fill("absent book");
  await expect(page.locator("#search-empty")).toBeVisible();
  await page.locator("#book-search").fill("LIN ZHOU");
  await expect(page.locator("#books button")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 750 });
  await page.locator("#books button").click();
  await expect(pageTitle).toHaveText("River passages");
  await expect(page.locator("#chapter-title")).toHaveText("Evening");
  const topPassage = () =>
    page
      .locator("#page")
      .evaluate(
        (scroll) =>
          [...scroll.querySelectorAll("#paragraphs > p")].find(
            (p) => p.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top + 1,
          )?.textContent,
      );
  await expect.poll(topPassage).toMatch(/^Passage 30\./);
  await page.reload();
  await expect.poll(topPassage).toMatch(/^Passage 30\./);
  await page.locator("#notes-open").click();
  await expect(page.locator("#notes blockquote")).toContainText("Passage 30.");
  await page.locator("#notes textarea").fill("Return at low tide.");
  await page.locator("#notes .tools button").first().click();
  await page.locator("#notes .tools button").nth(1).click();
  await expect(passage.locator("mark")).toBeInViewport();
  await page.locator("#show-library").click();
  await expect(page.locator("#resume-book")).toContainText("River passages");
  await page.locator("#book-search").fill("Garden");
  await page.locator("#books button").click();
  await expect(page.locator("#chapter-title")).toHaveText("Morning");
});
