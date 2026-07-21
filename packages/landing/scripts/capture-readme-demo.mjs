/**
 * Render the README "build an Agent app in one sentence" finished-product shot.
 *
 * The image shows the RESULT of the example — a Claude Code docs-expert RAG app —
 * rather than the build conversation: rag-app-mockup.html is a static, dependency-free
 * mockup of the generated app's UI (per the web-design skill's Penguin visual language),
 * captured per language (zh / en) and theme (light / dark) into assets/readme/ at the
 * repo root as rag-app-<lang>-<theme>.webp (README.md uses en, README.zh.md uses zh).
 *
 * Prereqs: Playwright's chromium only (no server, no build). Run:
 * `node scripts/capture-readme-demo.mjs [--png-dir <dir>]` (--png-dir also saves
 * lossless PNG copies, handy for reviewing the shots).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const OUT_DIR = path.resolve(ROOT, "assets/readme");
const PAGE = pathToFileURL(path.join(HERE, "rag-app-mockup.html")).href;

const pngDirArg = process.argv.indexOf("--png-dir");
const PNG_DIR = pngDirArg >= 0 ? process.argv[pngDirArg + 1] : null;

mkdirSync(OUT_DIR, { recursive: true });
if (PNG_DIR) mkdirSync(PNG_DIR, { recursive: true });

const browser = await chromium.launch();
const encoderPage = await browser.newPage();
async function saveWebp(pngBuffer, fileName) {
  const dataUrl = await encoderPage.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d").drawImage(img, 0, 0);
    return canvas.toDataURL("image/webp", 0.9);
  }, pngBuffer.toString("base64"));
  writeFileSync(path.join(OUT_DIR, fileName), Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(`[demo] ${fileName}`);
}

for (const lang of ["en", "zh"]) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 760 },
      deviceScaleFactor: 1.5,
      locale: lang === "zh" ? "zh-CN" : "en-US",
    });
    const page = await context.newPage();
    await page.goto(`${PAGE}?lang=${lang}&theme=${theme}`);
    await page.waitForTimeout(300);
    const png = await page.screenshot();
    if (PNG_DIR) writeFileSync(path.join(PNG_DIR, `rag-app-${lang}-${theme}.png`), png);
    await saveWebp(png, `rag-app-${lang}-${theme}.webp`);
    await context.close();
  }
}

await browser.close();
console.log("[demo] done");
