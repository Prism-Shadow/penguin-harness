/**
 * Render the app icon PNGs from the brand mark (packages/web/public/penguin-logo.svg,
 * treated as immutable — landing/docs carry byte-identical copies).
 *
 * Outputs (COMMITTED — regenerate only when the SVG changes):
 * - build/icon.png            1024×1024. electron-builder converts it to icns (mac,
 *                             >=512px required) and ico (win, >=256px) at pack time;
 *                             also the runtime BrowserWindow icon (see src/app-icon.ts).
 * - build/icon-mac.png        1024×1024 macOS master. The 824px artwork is centred on
 *                             the transparent canvas so Finder, Launchpad and the Dock
 *                             give it the same optical size as native macOS app icons.
 * - build/icons/<N>x<N>.png   128/256/512 freedesktop set for the Linux targets
 *                             (used as-is, no conversion).
 * - build/tray/tray.png       32×32 (+ @2x 64×64) colour tray icon for the Windows
 *                             notification area and Linux trays.
 * - build/tray/trayTemplate.png
 *                             16×16 (+ @2x 32×32) macOS menu bar image: a black silhouette
 *                             on transparency, which the menu bar inverts with its own
 *                             appearance. Reduced to the penguin's outline alone, with the
 *                             belly solid and the arcs around it dropped — see penguinOutline
 *                             below for why the whole mark cannot survive 16 pixels.
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
const TRAY_DIR = path.join(BUILD_DIR, "tray");

// Resolve @playwright/test from the landing package's context (it is not a dependency
// of this package, and must not become one).
const requireLanding = createRequire(path.join(REPO_ROOT, "packages", "landing", "package.json"));
const { chromium } = requireLanding("@playwright/test");

const svgSource = readFileSync(SVG_PATH, "utf8");
const dataUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
const svgDataUrl = dataUrl(svgSource);

/**
 * The penguin's own outline, lifted out of the brand mark for the macOS menu bar image.
 *
 * A template image is a mask: the menu bar paints every non-transparent pixel in its own colour
 * and throws the original away. Handing it the whole artwork gives up almost all of it — the
 * white backdrop flattens to a filled square, and the belly, which the artwork draws as a hole
 * letting that backdrop through, flattens to nothing. What survives at 16px is a wisp.
 *
 * So the mark is reduced to one shape before it is rasterized. The body path carries the penguin
 * as two subpaths, the outline and the belly cut out of it; taking the first alone gives the
 * outline with the belly solid. The two arcs sweeping around the penguin, its highlights and its
 * eye are separate paths and are simply not drawn — at this size they are noise.
 *
 * Matched on the body path's gradient reference rather than its geometry, so a reworked
 * illustration fails the render loudly instead of quietly shipping the wrong shape.
 */
const BODY_FILL = 'fill="url(#a)"';
function penguinOutline(source) {
  const path = source.match(/<path\s+fill="url\(#a\)"\s+d="([^"]+)"/)?.[1];
  if (path === undefined) return null;
  // Subpaths start at M or m; the second one is the belly, cut out of the first.
  const subpaths = path.match(/[Mm][^Mm]*/g) ?? [];
  return subpaths.length === 2 ? subpaths[0] : null;
}
const outline = penguinOutline(svgSource);
if (outline === null) {
  console.error(
    `[render-icon] could not take the penguin's outline out of ${path.relative(REPO_ROOT, SVG_PATH)}: ` +
      `expected one ${BODY_FILL} path of exactly two subpaths (the outline and the belly cut from it). ` +
      `Check the artwork and update penguinOutline().`,
  );
  process.exit(1);
}

/**
 * Wraps the outline in a square viewBox that its bounding box exactly inscribes, so the mark
 * fills the menu bar's width instead of sitting inside the artwork's rounded-square padding.
 *
 * It is a wide shape — about 4:3 — in a square canvas, so a band above and below is unavoidable;
 * cropping past the bounding box takes the beak off one side and the tail off the other. That
 * bounds the coverage at roughly a third of the canvas, which the icon test pins.
 */
function squareAround({ x, y, width, height }) {
  const side = Math.max(width, height);
  return `${x + width / 2 - side / 2} ${y + height / 2 - side / 2} ${side} ${side}`;
}

/**
 * Apple's 1024px app-icon template keeps the full rounded-square artwork inside an
 * 824×824 safe area. Unlike iOS, macOS does not add this margin for third-party icons:
 * handing electron-builder edge-to-edge artwork makes the icon visibly larger than its
 * neighbours in the Dock and Launchpad.
 */
const MAC_ARTWORK_RATIO = 824 / 1024;

/** icon.png is the Windows master; icon-mac.png is the padded macOS master. */
const targets = [
  { size: 1024, outPath: path.join(BUILD_DIR, "icon.png"), artworkRatio: 1 },
  { size: 1024, outPath: path.join(BUILD_DIR, "icon-mac.png"), artworkRatio: MAC_ARTWORK_RATIO },
  { size: 512, outPath: path.join(ICON_SET_DIR, "512x512.png"), artworkRatio: 1 },
  { size: 256, outPath: path.join(ICON_SET_DIR, "256x256.png"), artworkRatio: 1 },
  { size: 128, outPath: path.join(ICON_SET_DIR, "128x128.png"), artworkRatio: 1 },
  { size: 32, outPath: path.join(TRAY_DIR, "tray.png"), artworkRatio: 1 },
  { size: 64, outPath: path.join(TRAY_DIR, "tray@2x.png"), artworkRatio: 1 },
  { size: 16, outPath: path.join(TRAY_DIR, "trayTemplate.png"), artworkRatio: 1, template: true },
  {
    size: 32,
    outPath: path.join(TRAY_DIR, "trayTemplate@2x.png"),
    artworkRatio: 1,
    template: true,
  },
];

mkdirSync(ICON_SET_DIR, { recursive: true });
mkdirSync(TRAY_DIR, { recursive: true });

const browser = await chromium.launch();
try {
  // The bounding box comes from the renderer rather than a constant: it is a property of the
  // artwork, and a hand-copied number is what goes stale when the artwork moves.
  const measure = await browser.newPage();
  await measure.setContent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254"><path d="${outline}"/></svg>`,
  );
  const box = await measure.evaluate(() => {
    const { x, y, width, height } = document.querySelector("path").getBBox();
    return { x, y, width, height };
  });
  await measure.close();
  const templateDataUrl = dataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${squareAround(box)}">` +
      `<path fill="#000" d="${outline}"/></svg>`,
  );

  for (const { size, outPath, artworkRatio, template = false } of targets) {
    const artworkSize = size * artworkRatio;
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent}` +
        `body{display:flex;align-items:center;justify-content:center}` +
        `img{display:block;width:${artworkSize}px;height:${artworkSize}px}</style>` +
        `<img src="${template ? templateDataUrl : svgDataUrl}">`,
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
