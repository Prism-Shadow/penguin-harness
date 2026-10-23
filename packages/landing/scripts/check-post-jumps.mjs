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
 *   the entry's position once the scroll has settled, and marks it (`:target`), without leaving
 *   the page: no new tab or window, no page load. Each back-link brings its citation back, and on
 *   a wide screen each TOC entry its heading, the same way. Every link that names a place on the
 *   page is a bare `#…` link with no `target`.
 * - The post opened at `#fn-n` or at a heading (a shared link) lands there and marks it.
 * - Opened from the blog list (client-side navigation, the post's code and text loading on
 *   demand), a citation clicked straight away still lands.
 *
 * It serves `dist/` itself, the way GitHub Pages does (the route shells postbuild writes), and
 * answers every request that leaves the machine with nothing, except the posts' pictures: each
 * comes from a stand-in of the picture's real size (src/lib/blog-image-sizes.json; 1600x1000 for
 * one not recorded), `--late` ms after it is asked for (default 1200), so a jump made before the
 * pictures arrive shows whether anything still moves under it. `--every=N` clicks
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

const SIZES = JSON.parse(
  readFileSync(path.resolve(HERE, "../src/lib/blog-image-sizes.json"), "utf8"),
);
const COMMUNITY = "/penguin-harness-community/raw/refs/heads/main/blog-assets/";

/** A stand-in for the picture at `url`, at the size recorded for the post's source. */
function picture(url) {
  const at = url.indexOf(COMMUNITY);
  const src = at >= 0 ? `/blog-assets/${url.slice(at + COMMUNITY.length)}` : url;
  const [w, h] = SIZES[src] ?? [1600, 1000];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#999"/></svg>`;
}

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
    return {};
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
      const url = route.request().url();
      if (!url.includes(COMMUNITY) && !url.includes("github.com/user-attachments/"))
        return route.abort().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, LATE_MS));
      await route.fulfill({ contentType: "image/svg+xml", body: picture(url) }).catch(() => {});
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
  const page = await context.newPage();
  // Leaving the page shows as a popup (a new tab or window) or as a navigation request of the
  // page itself (a load); a jump within the page makes neither.
  let left = 0;
  page.on("popup", (p) => {
    left++;
    void p.close();
  });
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) left++;
  });
  const miss = (what, detail) => misses.push(`${where}: ${what}: ${detail}`);

  /** Click a link that should jump within the page, then judge where its target landed. */
  const jump = async (link, what) => {
    const href = await link.getAttribute("href");
    const before = left;
    await link.click();
    await settle(page);
    jumps++;
    const r = await landing(page, decodeURIComponent(href.slice(1)));
    if (left > before) miss(`${what} ${href}`, "left the page (a new tab, a window or a load)");
    else if (r.miss) miss(`${what} ${href}`, r.miss);
  };

  // Opened from the list, a citation clicked as soon as the body is there.
  await page.goto(`${BASE}/blog`, { waitUntil: "domcontentloaded" });
  await page.locator(`a[href$="/blog/${slug}"]`).first().click();
  await page.waitForSelector(".site-prose a[data-footnote-ref]");
  left = 0;
  await jump(page.locator(".site-prose a[data-footnote-ref]").first(), "from the list, citation");

  // Every link that names a place on this page is a bare `#…` link, opening nowhere else.
  const stray = await page.evaluate(() => {
    const here = location.pathname.replace(/\/+$/, "");
    return [...document.querySelectorAll("a[href]")]
      .filter((a) => {
        const url = new URL(a.getAttribute("href"), location.href);
        const samePage =
          url.origin === location.origin && url.pathname.replace(/\/+$/, "") === here;
        return samePage && url.hash.length > 1;
      })
      .filter((a) => !a.getAttribute("href").startsWith("#") || a.hasAttribute("target"))
      .map((a) => a.outerHTML.slice(0, 120));
  });
  for (const tag of stray) miss("in-page link", `not a bare # link, or it has a target: ${tag}`);

  // Every citation, every back-link, and on a wide screen every TOC entry.
  const count = (sel) => page.locator(sel).count();
  for (const [sel, what] of [
    [".site-prose a[data-footnote-ref]", "citation"],
    [".site-prose a[data-footnote-backref]", "back-link"],
    ...(width >= 1280 ? [["aside.site-toc a", "TOC entry"]] : []),
  ]) {
    const n = await count(sel);
    for (let i = 0; i < n; i += EVERY) await jump(page.locator(sel).nth(i), what);
  }

  // Opened at an entry's address, and at a heading's.
  const entries = await count(".site-prose [data-footnotes] li");
  const heading = await page.evaluate(
    () => [...document.querySelectorAll(".site-prose h2[id]:not(#footnote-label)")].at(-1)?.id,
  );
  for (const id of [`fn-${Math.ceil(entries / 2)}`, heading].filter(Boolean)) {
    const direct = await context.newPage();
    await direct.goto(`${BASE}/blog/${slug}#${encodeURIComponent(id)}`, {
      waitUntil: "domcontentloaded",
    });
    await direct.waitForSelector(".site-prose a[data-footnote-ref]");
    await direct.waitForTimeout(LATE_MS + 800);
    await settle(direct);
    jumps++;
    const opened = await landing(direct, id);
    if (opened.miss) miss(`opened at #${id}`, opened.miss);
    await direct.close();
  }
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
