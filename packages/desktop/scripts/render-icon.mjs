/**
 * Render the app icon PNGs from the brand mark (packages/web/public/penguin-logo.svg,
 * treated as immutable — landing/docs carry byte-identical copies).
 *
 * Outputs (COMMITTED — regenerate only when the SVG changes):
 * - build/icon.png            1024×1024. electron-builder converts it to icns (mac,
 *                             >=512px required) and ico (win, >=256px) at pack time;
 *                             also the runtime BrowserWindow icon (see src/app-icon.ts).
 * - build/icons/<N>x<N>.png   128/256/512 freedesktop set for the Linux targets
 *                             (used as-is, no conversion).
 *
 * Regenerate: node packages/desktop/scripts/render-icon.mjs
 * Rasterizes via the Playwright chromium already installed for packages/landing (no new
 * dependency; precedent: packages/landing/scripts/capture-readme-demo.mjs). Each size is
 * rendered at its native resolution (no downscaling), with a transparent background so
 * the SVG's rounded-rect clip keeps the corners transparent.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(PKG_DIR, "..", "..");
const SVG_PATH = path.join(REPO_ROOT, "packages", "web", "public", "penguin-logo.svg");
const BUILD_DIR = path.join(PKG_DIR, "build");
const ICON_SET_DIR = path.join(BUILD_DIR, "icons");

// Resolve @playwright/test from the landing package's context (it is not a dependency
// of this package, and must not become one).
const requireLanding = createRequire(path.join(REPO_ROOT, "packages", "landing", "package.json"));
const { chromium } = requireLanding("@playwright/test");

const svgDataUrl = `data:image/svg+xml;base64,${readFileSync(SVG_PATH).toString("base64")}`;

/** [size, output path]; icon.png is the 1024 master, the rest form the Linux icon set. */
const targets = [
  [1024, path.join(BUILD_DIR, "icon.png")],
  [512, path.join(ICON_SET_DIR, "512x512.png")],
  [256, path.join(ICON_SET_DIR, "256x256.png")],
  [128, path.join(ICON_SET_DIR, "128x128.png")],
];

mkdirSync(ICON_SET_DIR, { recursive: true });

const browser = await chromium.launch();
try {
  for (const [size, outPath] of targets) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}` +
        `img{display:block;width:${size}px;height:${size}px}</style>` +
        `<img src="${svgDataUrl}">`,
    );
    await page.evaluate(() => document.querySelector("img").decode());
    const png = await page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    writeFileSync(outPath, png);
    console.log(
      `[render-icon] ${path.relative(PKG_DIR, outPath)} (${size}x${size}, ${png.length} bytes)`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
