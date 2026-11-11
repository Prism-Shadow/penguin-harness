/**
 * The cleanliness counter: R2–R4 of the theme rules — nothing behind text but a flat fill, one
 * ink, no more boxes than Frost — as numbers read from a page. The budget guard
 * (e2e/cleanliness-budget.spec.mjs) runs it on five app surfaces for every built-in pack and holds
 * each pack to what Frost, the base, draws on the same surface, measured in the same run; run
 * directly, it prints the numbers for the packs and surfaces named.
 *
 * It looks at every rendered element (at least 20 × 14 px, not hidden). A closed box is an element
 * drawn with a border image, four visible border sides or a visible outline (a side or an outline
 * is visible from 0.5 px at an alpha over 0.08). Two kinds of box are exempt, because they are
 * where a theme may show its hand:
 *
 *   a control's edge  a form control or an interactive widget, by tag or ARIA role; the frame of a
 *                     text field (a box whose own child is a textarea, a text input or an editable
 *                     element: the composer); a host of `ui-edge`
 *   a floating layer  the edge of a `ui-glass` host that floats (a menu, a popover, the launcher's
 *                     caption) — not a tile or the navigation backdrop; R8 governs its line
 *
 * What the budget compares, page against page:
 *
 *   nonControl  the kinds of element drawn as a box that is not exempt. A kind is an element's
 *               tag, classes, slot and role: every pack renders the same markup, so a kind names
 *               the same element in every pack, and a denser pack that fits more of the same
 *               cards on screen draws no new kind
 *   textured    the kinds of element that hold text and sit on a background image or gradient
 *               (R2), outside the one texture home: the running work step, whose label sweep
 *               carries its state
 *   inks        the distinct line colours of the boxes that are not exempt (R3); every border
 *               image is one
 *
 * A pack breaches when it boxes a kind Frost does not box, puts text of a kind on a texture where
 * Frost does not, or draws more than one line colour beyond Frost's (R3 allows the accent's line
 * beside the theme's own). The counts in the window — every box, the ones not exempt, border
 * images, text on a texture, painting pseudo-elements — are read too, for the record.
 *
 *   node scripts/cleanliness.mjs --base http://localhost:7372/ [--packs github,geek]
 *     [--surfaces chat,models] [--mode dark] [--lang zh] [--json out.json]
 *
 * The gallery must already be served at --base (`pnpm dev`, or `vite preview` of a build; under a
 * subpath, with its trailing slash). No network beyond it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { surfaceById } from "../src/app/surfaces.ts";
import { BUILTIN_PACKS } from "../../ui/src/themes/index.ts";

/** The surfaces the budget holds: the start page, two conversations, two pages of rows. */
export const BUDGET_SURFACES = ["chat-new", "chat", "chat-running", "models", "usage"];

/** The window the surfaces are read in: the app frame's own size. */
export const BUDGET_VIEWPORT = { width: 1280, height: 800 };

/** The fixed clock every reading runs under, so relative times and charts are the same each run. */
export const BUDGET_CLOCK = "2026-11-05T10:00:00Z";

/**
 * The base every pack is held to: Frost, the one built-in pack that is its own base (`base:
 * "modern"` names Frost).
 */
export const BASE_PACK = BUILTIN_PACKS.find((pack) => pack.id === pack.base);

/** The counts the budget holds a pack to, in the order a report lists them. */
export const BUDGET_METRICS = ["nonControl", "textured", "inks"];

/** What a pack's reading has past the base's, per metric: the kinds, or the colours, in excess. */
function excess(pack, base) {
  const newKinds = (mine, theirs) =>
    Object.entries(mine)
      .filter(([kind]) => !Object.hasOwn(theirs, kind))
      .map(([, entry]) => (entry.n > 1 ? `${entry.what} ×${entry.n}` : entry.what));
  return {
    nonControl: newKinds(pack.boxKinds, base.boxKinds),
    textured: newKinds(pack.textureKinds, base.textureKinds),
    inks: pack.lineColours.filter((colour) => !base.lineColours.includes(colour)),
  };
}

/**
 * Where a pack's reading goes past its budget on one surface. Per metric: what the pack measures
 * (new kinds, or all its line colours), the budget (no new kind; Frost's colours and one more),
 * widened by what `held` allows that pack, and what is in excess, named.
 */
export function budgetBreaches(pack, base, held = {}) {
  const over = excess(pack, base);
  const measured = {
    nonControl: over.nonControl.length,
    textured: over.textured.length,
    inks: pack.lineColours.length,
  };
  const allowed = { nonControl: 0, textured: 0, inks: base.lineColours.length + 1 };
  const breaches = [];
  for (const metric of BUDGET_METRICS) {
    const budget = allowed[metric] + (held[metric] ?? 0);
    if (measured[metric] > budget) {
      breaches.push({ metric, measured: measured[metric], budget, what: over[metric] });
    }
  }
  return breaches;
}

/**
 * Counts the document it runs in (passed to `page.evaluate`, so it must stay self-contained): the
 * kinds and colours the budget compares, over the whole rendered page, and the counts in the
 * window, for the record.
 */
export function measureCleanliness() {
  const vw = innerWidth;
  const vh = innerHeight;
  const CONTROL_TAGS = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA"]);
  const CONTROL_ROLES = new Set([
    "button",
    "checkbox",
    "combobox",
    "radio",
    "searchbox",
    "slider",
    "spinbutton",
    "switch",
    "tab",
    "textbox",
  ]);
  const TEXT_FIELD =
    'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable="true"], [contenteditable=""], [role="textbox"]';
  const FLOATING = '.ui-glass:not([data-glass="tile"], [data-glass="navigation"])';
  const TEXTURE_HOME = '.ui-activity[data-state="running"]';
  const alpha = (c) => {
    if (!c || c === "transparent") return 0;
    const m = c.match(/^(?:rgb|hsl|oklch|oklab|lab|lch|color)a?\(([^)]*)\)/);
    if (!m) return 1;
    const slash = m[1].split("/");
    if (slash.length > 1) return parseFloat(slash[1]);
    const comma = m[1].split(",");
    return comma.length >= 4 ? parseFloat(comma[3]) : 1;
  };
  const exempt = (el) => {
    if (CONTROL_TAGS.has(el.tagName) || CONTROL_ROLES.has(el.getAttribute("role") ?? ""))
      return true;
    if (el.classList.contains("ui-edge") || el.matches(FLOATING)) return true;
    for (const child of el.children) if (child.matches(TEXT_FIELD)) return true;
    return false;
  };
  const ownText = (el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  };
  const kindOf = (el) =>
    [
      el.tagName,
      el.getAttribute("class") ?? "",
      el.getAttribute("data-slot") ?? "",
      el.getAttribute("role") ?? "",
    ].join("|");
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const hook = [...el.classList].find((c) => c.startsWith("ui-"));
    const slot = el.getAttribute("data-slot");
    const name = (el.getAttribute("aria-label") || el.textContent || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 32);
    return `${tag}${hook ? `.${hook}` : ""}${slot ? `[data-slot="${slot}"]` : ""}${name ? ` "${name}"` : ""}`;
  };
  const tally = (kinds, el) => {
    const kind = kindOf(el);
    if (kinds[kind]) kinds[kind].n += 1;
    else kinds[kind] = { what: describe(el), n: 1 };
  };
  const inWindow = { boxes: 0, nonControl: 0, images: 0, textured: 0, pseudo: 0 };
  const boxKinds = {};
  const textureKinds = {};
  const lineColours = new Set();
  const windowColours = new Set();
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 14) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0" || cs.display === "none") continue;
    const inView = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    const image = cs.borderImageSource !== "none";
    const sides = ["Top", "Right", "Bottom", "Left"].filter(
      (s) =>
        parseFloat(cs[`border${s}Width`]) >= 0.5 &&
        cs[`border${s}Style`] !== "none" &&
        alpha(cs[`border${s}Color`]) > 0.08,
    );
    const outlined =
      cs.outlineStyle !== "none" &&
      parseFloat(cs.outlineWidth) >= 0.5 &&
      alpha(cs.outlineColor) > 0.08;
    if (image || sides.length === 4 || outlined) {
      const free = exempt(el);
      const colour = image ? "image" : sides.length === 4 ? cs.borderTopColor : cs.outlineColor;
      if (!free) {
        tally(boxKinds, el);
        lineColours.add(colour);
      }
      if (inView) {
        inWindow.boxes += 1;
        if (image) inWindow.images += 1;
        if (!free) {
          inWindow.nonControl += 1;
          windowColours.add(colour);
        }
      }
    }
    if (
      cs.backgroundImage !== "none" &&
      el.tagName !== "IMG" &&
      !el.closest(TEXTURE_HOME) &&
      (ownText(el) || (el.innerText ?? "").trim().length > 40)
    ) {
      tally(textureKinds, el);
      if (inView) inWindow.textured += 1;
    }
    if (!inView) continue;
    for (const p of ["::before", "::after"]) {
      const ps = getComputedStyle(el, p);
      if (ps.content === "none" || ps.content === "normal") continue;
      if (
        ps.backgroundImage !== "none" ||
        ps.borderImageSource !== "none" ||
        (ps.borderTopStyle !== "none" && parseFloat(ps.borderTopWidth) > 0) ||
        (ps.borderLeftStyle !== "none" && parseFloat(ps.borderLeftWidth) > 0) ||
        alpha(ps.backgroundColor) > 0.05
      ) {
        inWindow.pseudo += 1;
      }
    }
  }
  return {
    window: { ...inWindow, inks: windowColours.size },
    boxKinds,
    textureKinds,
    lineColours: [...lineColours],
  };
}

/** The framed app's address for a surface under a pack, in the budget's fixed preferences. */
export function surfaceUrl(surfaceId, packId, { mode = "light", lang = "en" } = {}) {
  const surface = surfaceById(surfaceId);
  if (!surface) throw new Error(`unknown surface: ${surfaceId}`);
  const params = new URLSearchParams({
    route: surface.route,
    theme: packId,
    mode,
    accent: "neutral",
    size: "m",
    latin: "theme",
    cjk: "theme",
    lang,
  });
  if (surface.signedOut) params.set("auth", "out");
  if (surface.open) params.set("open", surface.open);
  return `app.html?${params}`;
}

/** What two readings must agree on to count as settled: the window's counts and the kinds. */
const settled = (reading) =>
  JSON.stringify([
    reading.window,
    Object.keys(reading.boxKinds).sort(),
    Object.keys(reading.textureKinds).sort(),
    [...reading.lineColours].sort(),
  ]);

/**
 * Opens a surface under a pack in a page whose viewport, clock and motion are already set (see
 * {@link prepareContext}), waits for the app and its fonts, and counts once two readings a beat
 * apart agree: the demo data lands a moment after the first paint.
 */
export async function readSurface(page, baseUrl, surfaceId, packId, options) {
  const surface = surfaceById(surfaceId);
  await page.goto(new URL(surfaceUrl(surfaceId, packId, options), baseUrl).href);
  await page.waitForSelector("html[data-gallery-ready]", { timeout: 45_000 });
  if (surface.open) await page.waitForSelector('[role="dialog"]', { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  let last = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.waitForTimeout(300);
    const reading = await page.evaluate(measureCleanliness);
    if (last && settled(last) === settled(reading)) return reading;
    last = reading;
  }
  return last;
}

/** A browser context in the budget's window, clock and motion. */
export async function prepareContext(browser) {
  const context = await browser.newContext({ viewport: BUDGET_VIEWPORT, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(BUDGET_CLOCK));
  return { context, page };
}

/** Run directly: print each pack's counts on each surface, and its breaches against the base. */
async function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const baseUrl = arg("base");
  if (!baseUrl) throw new Error("--base <the served gallery's URL> is required");
  const list = (v, d) => (v ? v.split(",").filter(Boolean) : d);
  const packs = list(
    arg("packs"),
    BUILTIN_PACKS.map((pack) => pack.id),
  );
  const surfaces = list(arg("surfaces"), BUDGET_SURFACES);
  const options = { mode: arg("mode", "light"), lang: arg("lang", "en") };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire(path.join(here, "../package.json"))("@playwright/test");
  const browser = await chromium.launch({
    env: { ...process.env, FONTCONFIG_FILE: path.join(here, "fonts.conf") },
  });
  const { page } = await prepareContext(browser);
  const result = {};
  for (const surface of surfaces) {
    const base = await readSurface(page, baseUrl, surface, BASE_PACK.id, options);
    for (const pack of packs) {
      const counts =
        pack === BASE_PACK.id ? base : await readSurface(page, baseUrl, surface, pack, options);
      (result[pack] ??= {})[surface] = counts;
      const w = counts.window;
      const line = Object.entries(w)
        .map(([k, v]) => `${k}=${v}`)
        .join("\t");
      const over = pack === BASE_PACK.id ? [] : budgetBreaches(counts, base);
      const breach = over.map((b) => `${b.metric} ${b.measured}>${b.budget}: ${b.what.join("; ")}`);
      console.log(
        `${pack}\t${surface}\t${line}${breach.length ? `\tOVER ${breach.join(" | ")}` : ""}`,
      );
    }
  }
  const out = arg("json");
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));
  await browser.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
