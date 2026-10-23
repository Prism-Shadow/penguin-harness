/**
 * Checks that jumps in the blog's posts land where a reader expects, in real browser engines:
 * normal motion (smooth scrolling on), and the posts' pictures arriving late, as they do from
 * the community repo that hosts them.
 *
 *   pnpm --filter @prismshadow/penguin-landing build
 *   node scripts/check-post-jumps.mjs [slug …] [--browsers=chromium,firefox,webkit] [--every=N]
 *
 * For each post that cites sources, in English and Chinese, at 1280 and 390 px wide:
 *
 * - Clicking a citation brings its reference entry to just below the sticky header, measured by
 *   the entry's position once the scroll has settled, and marks it (`:target`), with no new tab
 *   and no reload. Each back-link brings its citation back the same way.
 * - The post opened at `#fn-n` (a shared link) lands on entry n and marks it.
 * - Opened from the blog list (client-side navigation, the post's code and text loading on
 *   demand), a citation clicked straight away still lands.
 *
 * It serves `dist/` itself, the way GitHub Pages does (the route shells postbuild writes), and
 * answers every request that leaves the machine with nothing, except the posts' pictures: those
 * come from a stand-in, `--late` ms after they are asked for (default 1200), with no size known
 * in advance, so a jump made before they arrive shows whether it still lands. `--every=N` clicks
 * every Nth citation and back-link. An engine Playwright has not installed is skipped with a
 * note (`pnpm --filter @prismshadow/penguin-landing exec playwright install firefox webkit`).
 * Exits 1 when any jump misses, listing each.
 */
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as engines from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "../dist");
const POSTS = path.resolve(HERE, "../content/blog");
const PORT = 7391;
const BASE = `http://127.0.0.1:${PORT}`;

const args = process.argv.slice(2);
const option = (name, fallback) =>
  (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1];
const BROWSERS = option("browsers", "chromium").split(",");
const EVERY = Math.max(1, Number(option("every", "1")));
const LATE_MS = Number(option("late", "1200"));
const named = args.filter((a) => !a.startsWith("--"));

/** Posts that cite: a slug whose English or Chinese text holds a footnote reference. */
const citing = [
  ...new Set(
    readdirSync(POSTS)
      .filter(
        (f) =>
          /\.(en|zh)\.md$/.test(f) &&
          /\[\^[^\]]+\]/.test(readFileSync(path.join(POSTS, f), "utf8")),
      )
      .map((f) => f.replace(/\.(en|zh)\.md$/, "")),
  ),
];
const slugs = named.length > 0 ? named : citing;

if (!existsSync(path.join(DIST, "index.html"))) {
  console.error("no dist/: run `pnpm --filter @prismshadow/penguin-landing build` first");
  process.exit(2);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".png": "image/png",
};
const server = createServer((req, res) => {
  let file = path.join(DIST, decodeURIComponent(new URL(req.url, BASE).pathname));
  if (!file.startsWith(DIST)) file = DIST;
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!existsSync(file)) file = path.join(DIST, "index.html");
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const PICTURE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#999"/></svg>';

/** Resolves once the page has stopped scrolling (a smooth scroll included). */
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const start = performance.now();
        let last = -1;
        let still = 0;
        const tick = () => {
          still = scrollY === last ? still + 1 : 0;
          last = scrollY;
          const t = performance.now() - start;
          if ((still >= 8 && t > 80) || t > 6000) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

/** Where the element with this id sits once a jump to it is over. */
const landing = (page, id) =>
  page.evaluate((id) => {
    const el = document.getElementById(id);
    const header =
      document.querySelector("header.site-ui-header")?.getBoundingClientRect().bottom ?? 0;
    if (!el) return { miss: "no such element" };
    const top = el.getBoundingClientRect().top;
    const atEnd = scrollY >= document.documentElement.scrollHeight - innerHeight - 2;
    const placed =
      (top >= header - 1 && top <= header + 40) ||
      (atEnd && top >= header - 1 && top < innerHeight);
    const marked = document.querySelector(":target") === el;
    if (!placed)
      return { miss: `its top is at ${Math.round(top)} px (header ends at ${Math.round(header)})` };
    if (!marked) return { miss: "not marked as the target" };
    return { token: window.__jumps };
  }, id);

const misses = [];
let jumps = 0;

async function openContext(browser, lang, width) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    reducedMotion: "no-preference",
  });
  await context.route(
    (url) => url.hostname !== "127.0.0.1",
    async (route) => {
      if (!/penguin-harness-community\/raw\//.test(route.request().url()))
        return route.abort().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, LATE_MS));
      await route.fulfill({ contentType: "image/svg+xml", body: PICTURE }).catch(() => {});
    },
  );
  await context.addInitScript((lang) => {
    try {
      localStorage.setItem("penguin-site.lang", lang);
    } catch {}
  }, lang);
  return context;
}

async function check(engine, browser, slug, lang, width) {
  const where = `${engine} ${slug} ${lang} ${width}`;
  const context = await openContext(browser, lang, width);
  let popups = 0;
  const page = await context.newPage();
  page.on("popup", (p) => {
    popups++;
    void p.close();
  });
  const miss = (what, detail) => misses.push(`${where}: ${what}: ${detail}`);

  // Opened from the list, a citation clicked as soon as the body is there.
  await page.goto(`${BASE}/blog`, { waitUntil: "domcontentloaded" });
  await page.locator(`a[href$="/blog/${slug}"]`).first().click();
  await page.waitForSelector(".site-prose a[data-footnote-ref]");
  await page.evaluate(() => (window.__jumps = Math.random()));
  const token = await page.evaluate(() => window.__jumps);
  const first = page.locator(".site-prose a[data-footnote-ref]").first();
  const firstHref = await first.getAttribute("href");
  await first.click();
  await settle(page);
  jumps++;
  const early = await landing(page, firstHref.slice(1));
  if (early.miss) miss(`from the list, ${firstHref}`, early.miss);

  // Every citation, then every back-link.
  const count = (sel) => page.locator(sel).count();
  for (const [sel, kind] of [
    [".site-prose a[data-footnote-ref]", "citation"],
    [".site-prose a[data-footnote-backref]", "back-link"],
  ]) {
    const n = await count(sel);
    for (let i = 0; i < n; i += EVERY) {
      const link = page.locator(sel).nth(i);
      const href = await link.getAttribute("href");
      const before = popups;
      await link.click();
      await settle(page);
      jumps++;
      const r = await landing(page, href.slice(1));
      if (popups > before) miss(`${kind} ${href}`, "opened a new tab");
      else if (r.miss) miss(`${kind} ${href}`, r.miss);
      else if (r.token !== token) miss(`${kind} ${href}`, "reloaded the page");
    }
  }

  // Opened at an entry's address.
  const entries = await count(".site-prose [data-footnotes] li");
  const id = `fn-${Math.ceil(entries / 2)}`;
  const direct = await context.newPage();
  await direct.goto(`${BASE}/blog/${slug}#${id}`, { waitUntil: "domcontentloaded" });
  await direct.waitForSelector(".site-prose a[data-footnote-ref]");
  await direct.waitForTimeout(LATE_MS + 800);
  await settle(direct);
  jumps++;
  const opened = await landing(direct, id);
  if (opened.miss) miss(`opened at #${id}`, opened.miss);
  await context.close();
}

let ran = 0;
for (const engine of BROWSERS) {
  let browser;
  try {
    browser = await engines[engine].launch();
  } catch (error) {
    console.log(`${engine}: skipped, it does not launch here (${String(error).split("\n")[0]})`);
    continue;
  }
  ran++;
  for (const slug of slugs)
    for (const lang of ["en", "zh"])
      for (const width of [1280, 390]) {
        try {
          await check(engine, browser, slug, lang, width);
        } catch (error) {
          misses.push(
            `${engine} ${slug} ${lang} ${width}: the check failed: ${String(error).split("\n")[0]}`,
          );
        }
      }
  await browser.close();
}
server.close();

console.log(
  `${jumps} jumps in ${ran} engine(s) over ${slugs.length} post(s): ${misses.length} missed`,
);
for (const line of misses) console.log(`- ${line}`);
process.exit(ran === 0 || misses.length > 0 ? 1 : 0);
