#!/usr/bin/env node
/**
 * Screenshots of the app's surfaces through the gallery's frame document: one PNG per surface ×
 * theme × mode × language, written to `<out>/<theme>/<mode>/<lang>/<surface>.png` — the app at its
 * window width (1280 × 800), or at phone width with `--view phone`.
 *
 * Needs the gallery running (`pnpm dev:gallery`, port 7372) and Playwright's Chromium. Shots are
 * never committed.
 *
 *   node scripts/shots.mjs --surfaces chat,models --themes modern --modes light,dark --langs en
 *   node scripts/shots.mjs --surfaces all --out /tmp/gallery-shots
 *
 * Options (comma lists):
 *   --base      gallery origin                 (default http://localhost:7372)
 *   --out       output directory               (default packages/ui-gallery/shots)
 *   --surfaces  surface ids, or `all`          (default all)
 *   --themes    github,modern,geek             (default: all three)
 *   --modes     light,dark                     (default: both)
 *   --langs     en,zh                          (default: both)
 *   --size      xs | s | m | l | xl            (default m: the 16 px root)
 *   --latin     a Latin pairing id             (default theme)
 *   --cjk       a CJK pairing id               (default theme)
 *   --accent    an accent preset id            (default: the theme's own accent)
 *   --view      desktop | phone                (default desktop)
 *   --settle    ms to wait after the app reports ready (default 1200: the demo API answers with
 *                                               a beat, and a running Session's stream needs a
 *                                               moment to show its first frame)
 *
 * Fonts must be the real ones: Chromium runs with FONTCONFIG_FILE=scripts/fonts.conf, which
 * sends a sans-serif request lighter than regular to MiSans (installed by hand under
 * ~/.local/share/fonts) rather than to a synthetic thin face.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
// Read by Node's type stripping: the module carries no value import, by design (see its doc).
import { SURFACE_IDS, surfaceById } from "../src/app/surfaces.ts";

/** The frames the gallery uses (src/app/frame.ts, which Node cannot import: it reaches the package's boot module). */
const APP_FRAME = { width: 1280, height: 800 };
const PHONE_FRAME = { width: 390, height: 844 };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTCONFIG_FILE = path.join(HERE, "fonts.conf");

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg, i, all) => (arg.startsWith("--") ? [arg.slice(2), all[i + 1] ?? ""] : null))
    .filter(Boolean),
);
const list = (value, fallback) =>
  value === undefined || value === "" ? fallback : value.split(",");

const base = args.base ?? "http://localhost:7372";
const out = args.out ?? path.join(HERE, "..", "shots");
const surfaces =
  args.surfaces === undefined || args.surfaces === "all"
    ? [...SURFACE_IDS]
    : list(args.surfaces, []);
const themes = list(args.themes, ["github", "modern", "geek"]);
const modes = list(args.modes, ["light", "dark"]);
const langs = list(args.langs, ["en", "zh"]);
const size = args.size ?? "m";
const latin = args.latin ?? "theme";
const cjk = args.cjk ?? "theme";
const accent = args.accent ?? "neutral";
const view = args.view === "phone" ? "phone" : "desktop";
const settle = Number(args.settle ?? 1200);
const frame = view === "phone" ? PHONE_FRAME : APP_FRAME;

const browser = await chromium.launch({ env: { ...process.env, FONTCONFIG_FILE } });
const context = await browser.newContext({
  viewport: { width: frame.width, height: frame.height },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
let shots = 0;
for (const theme of themes) {
  for (const mode of modes) {
    for (const lang of langs) {
      const dir = path.join(out, theme, mode, lang);
      mkdirSync(dir, { recursive: true });
      for (const id of surfaces) {
        const surface = surfaceById(id);
        if (!surface) {
          console.error(`unknown surface: ${id}`);
          process.exitCode = 1;
          continue;
        }
        const params = new URLSearchParams({
          route: surface.route,
          theme,
          mode,
          accent,
          size,
          latin,
          cjk,
          lang,
        });
        if (surface.signedOut) params.set("auth", "out");
        if (surface.open) params.set("open", surface.open);
        await page.goto(`${base}/app.html?${params}`, { waitUntil: "load" });
        await page.waitForSelector("html[data-gallery-ready]", { timeout: 30_000 });
        // A surface that opens a dialog is not ready until the dialog is on screen.
        if (surface.open) await page.waitForSelector('[role="dialog"]', { timeout: 30_000 });
        await page.waitForTimeout(settle);
        const file = path.join(dir, `${id}.png`);
        await page.screenshot({ path: file });
        shots += 1;
        console.log(path.relative(process.cwd(), file));
      }
    }
  }
}
await browser.close();
console.log(`${shots} shots`);
