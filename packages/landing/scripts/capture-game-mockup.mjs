/**
 * Render the landing Cases tab's "penguin sled game" finished-product shot.
 *
 * Same pattern as capture-readme-demo.mjs: penguin-game-mockup.html is a static,
 * dependency-free mockup of the example game's play screen, captured per language
 * (zh / en) and theme (light = polar day / dark = polar night) into
 * packages/landing/src/assets as game-<lang>-<theme>.webp.
 *
 * Prereqs: Playwright's chromium only (no server, no build). Run:
 * `node scripts/capture-game-mockup.mjs [--png-dir <dir>]`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, "../src/assets");
const PAGE = pathToFileURL(path.join(HERE, "penguin-game-mockup.html")).href;

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
  console.log(`[game] ${fileName}`);
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
    if (PNG_DIR) writeFileSync(path.join(PNG_DIR, `game-${lang}-${theme}.png`), png);
    await saveWebp(png, `game-${lang}-${theme}.webp`);
    await context.close();
  }
}

await browser.close();
console.log("[game] done");
