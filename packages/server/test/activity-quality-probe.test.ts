/**
 * The keyboard probe's text, run for real: a page set from a string in a local Chromium, with
 * no network. Skipped where Playwright's Chromium is not installed.
 */
import fs from "node:fs";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGE_PROBE, readProbe } from "../src/activities/quality-accessibility.js";

const executable = (() => {
  try {
    const file = chromium.executablePath();
    return file && fs.existsSync(file) ? file : null;
  } catch {
    return null;
  }
})();

describe.skipIf(!executable)("keyboard probe text, in a real browser", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: executable!, headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  async function probe(html: string) {
    const page = await browser.newPage();
    try {
      await page.route("**/*", (route) => route.abort());
      await page.setContent(html);
      return readProbe(await page.evaluate(PAGE_PROBE));
    } finally {
      await page.close();
    }
  }

  it("keeps a sentence whole when a word in it is marked up", async () => {
    const { text } = await probe(
      `<main><p>The <b>big</b> dog ran far away from the <mark>old</mark> red house.</p>` +
        `<button>Next <span>page</span></button><p style="display:none">Hidden words</p>` +
        `<script>var words = "not shown";</script></main>`,
    );
    expect(text).toEqual(["The big dog ran far away from the old red house.", "Next page"]);
  }, 30_000);
});
