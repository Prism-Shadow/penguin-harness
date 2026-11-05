/**
 * Render a social share card: the site's (index.html's og:image / twitter:image) or a page's own
 * (a page route's `meta.image` in site-routes.mjs).
 *
 * Same pattern as capture-readme-demo.mjs: og-<name>.html is a static, dependency-free mockup,
 * captured at exactly 1200x630 into packages/landing/public/og-<name>.png — public/ rather than
 * src/assets/ because the URL has to be stable and absolute for the platforms that fetch it, not a
 * hashed bundle asset. PNG, not WebP: WeChat and a few older unfurlers still ignore WebP previews.
 *
 * The output is committed, so this only needs re-running when the HTML changes.
 * Prereqs: Playwright's chromium only. Run: `node scripts/capture-og-cover.mjs` for the site's
 * card (og-cover), `node scripts/capture-og-cover.mjs amsp` for og-amsp.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const NAME = process.argv[2] ?? "cover";
if (!/^[a-z0-9-]+$/.test(NAME)) throw new Error(`[og] not a card name: ${NAME}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(HERE, `og-${NAME}.html`)).href;
const OUT = path.resolve(HERE, `../public/og-${NAME}.png`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(PAGE);
// The logo is an <img>; screenshotting before it decodes yields a card with a hole in it.
await page.waitForFunction(() => {
  const img = document.querySelector("img.logo");
  return img !== null && img.complete && img.naturalWidth > 0;
});
writeFileSync(OUT, await page.screenshot());
await browser.close();
console.log(`[og] wrote ${OUT}`);
