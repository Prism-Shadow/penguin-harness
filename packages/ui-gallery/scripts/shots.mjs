#!/usr/bin/env node
/**
 * Screenshots of the gallery's modules through `/embed`: one PNG per module × variant × theme ×
 * mode × language, written to `<out>/<theme>/<mode>/<lang>/<module>--<variant>.png`. `--parts`
 * adds every part that has a demo, as `<part-id>--<pick>.png` beside them.
 *
 * Needs the gallery running (`pnpm dev:gallery`, port 7372) and Playwright's Chromium. Shots are
 * never committed.
 *
 *   node scripts/shots.mjs --modules conversation,status --themes modern --modes light,dark --langs en
 *   node scripts/shots.mjs --modules all --variants all --out /tmp/gallery-shots
 *   node scripts/shots.mjs diff <before-dir> <after-dir>
 *
 * Options (comma lists):
 *   --base      gallery origin                 (default http://localhost:7372)
 *   --out       output directory               (default packages/ui-gallery/shots)
 *   --modules   module ids, or `all`           (default all)
 *   --themes    github,modern,geek             (default: all three)
 *   --modes     light,dark                     (default: both)
 *   --langs     en,zh                          (default: both)
 *   --tier      sm | md | lg                   (default md)
 *   --variants  default | all                  (default: each module's first variant only)
 *   --parts     also shoot every part demo     (flag)
 *   --width     viewport width in px           (default 758: the main page's card, so a shot
 *                                               lays out exactly as the card does)
 *
 * Animations are frozen (`motion=reduced`) so two runs of the same tree compare pixel for pixel.
 *
 * Fonts must be the real ones. Before the first shot of each theme × language the script loads
 * every family that theme names for that language's specimen and fails the run when one has no
 * loaded face: a silent fallback to a system face is a failed run, not a screenshot. Chromium runs
 * with FONTCONFIG_FILE=scripts/fonts.conf, which sends a sans-serif request lighter than regular to
 * MiSans (MiSans-Light.ttf in ~/.local/share/fonts, installed by hand) rather than to a synthetic
 * thin face.
 *
 * `diff` compares two shot trees pixel by pixel in the browser and lists what moved, what was
 * added and what disappeared; it exits 1 when anything moved.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { CATALOG } from "../../ui/src/catalog.ts";
import { MODULE_IDS } from "../../ui/src/module.ts";
import { THEME_IDS, THEME_MODES } from "../../ui/src/tokens.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTCONFIG_FILE = path.join(HERE, "fonts.conf");

/** Each theme's webfont families, by the weights its tokens and recipes ask for. */
const THEME_FONTS = {
  // W0 keeps Primer on the system stacks; W1a brings Mona Sans.
  github: { en: [], zh: [] },
  modern: {
    en: [
      ["MiSans", "400"],
      ["MiSans", "500"],
      ["JetBrains Mono Variable", "400"],
    ],
    zh: [
      ["MiSans", "400"],
      ["MiSans", "500"],
    ],
  },
  geek: {
    en: [
      ["IBM Plex Sans Variable", "400"],
      ["IBM Plex Sans Variable", "600"],
      ["IBM Plex Sans Condensed", "600"],
      ["Commit Mono", "400"],
    ],
    zh: [
      ["IBM Plex Sans Variable", "400"],
      ["Noto Sans SC Variable", "400"],
      ["Noto Sans SC Variable", "600"],
    ],
  },
};
const SPECIMEN = {
  en: "Agents that cite their sources 0123456789",
  zh: "构建 Claude Code 文档专家，引用来源",
};
/** The languages the font gate can check, and the tiers `/embed` understands (`lib/url-state.ts`). */
const LANGS = Object.keys(SPECIMEN);
const TIERS = ["sm", "md", "lg"];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      args._.push(key);
      continue;
    }
    if (key === "--parts") {
      args.parts = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${key} needs a value`);
    args[key.slice(2)] = value;
    i++;
  }
  return args;
}

const list = (value, fallback) =>
  value
    ? value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : fallback;

const args = parseArgs(process.argv.slice(2));

if (args._[0] === "diff") {
  process.exitCode = await diff(args._[1], args._[2]);
} else {
  process.exitCode = await shoot();
}

async function shoot() {
  const base = (args.base ?? "http://localhost:7372").replace(/\/$/, "");
  const out = path.resolve(args.out ?? path.join(HERE, "..", "shots"));
  const modules =
    args.modules === undefined || args.modules === "all" ? [...MODULE_IDS] : list(args.modules);
  const themes = list(args.themes, [...THEME_IDS]);
  const modes = list(args.modes, [...THEME_MODES]);
  const langs = list(args.langs, LANGS);
  const tier = args.tier ?? "md";
  const allVariants = args.variants === "all";
  const width = Number(args.width ?? 758);

  // Every axis is validated against the values `/embed` understands. An unknown one is not a
  // smaller run: `/embed` falls back to its default, so the shots would be a complete, convincing
  // set filed under another name — and an unknown language additionally leaves `wanted` empty,
  // which switches the font gate off without a word.
  const bad = [
    ["modules", modules, MODULE_IDS],
    ["themes", themes, THEME_IDS],
    ["modes", modes, THEME_MODES],
    ["langs", langs, LANGS],
    ["tier", [tier], TIERS],
  ].flatMap(([name, given, known]) => {
    const unknown = given.filter((value) => !known.includes(value));
    return unknown.length > 0
      ? [`unknown --${name}: ${unknown.join(", ")} (known: ${known.join(", ")})`]
      : [];
  });
  if (bad.length > 0) {
    console.error(bad.join("\n"));
    return 2;
  }
  try {
    const res = await fetch(`${base}/`);
    if (!res.ok) throw new Error(String(res.status));
  } catch (error) {
    console.error(
      `the gallery is not answering at ${base} (${error.message}); start it with \`pnpm dev:gallery\``,
    );
    return 2;
  }

  const browser = await chromium.launch({ env: { ...process.env, FONTCONFIG_FILE } });
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const embed = (params) => {
    const q = new URLSearchParams({ ...params, tier, motion: "reduced" });
    return `${base}/embed?${q}`;
  };
  const ready = async () => {
    await page.waitForSelector("html[data-gallery-ready]", { timeout: 30_000 });
    // The Screens module frames /screens pages: wait for them too.
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("#embed-root iframe")].every(
          (frame) => frame.contentDocument?.documentElement?.dataset.galleryReady === "1",
        ),
      undefined,
      { timeout: 30_000 },
    );
  };
  const fontFailures = [];
  const checkFonts = async (theme, lang) => {
    const wanted = THEME_FONTS[theme]?.[lang] ?? [];
    const missing = await page.evaluate(
      async ({ wanted, text }) => {
        const gaps = [];
        for (const [family, weight] of wanted) {
          const faces = await document.fonts.load(`${weight} 16px "${family}"`, text);
          if (!faces.some((face) => face.status === "loaded")) gaps.push(`${family} ${weight}`);
        }
        for (const face of document.fonts) {
          if (face.status === "error") gaps.push(`${face.family} ${face.weight} failed to load`);
        }
        return gaps;
      },
      { wanted, text: SPECIMEN[lang] },
    );
    if (missing.length > 0) fontFailures.push(`${theme} ${lang}: ${missing.join(", ")}`);
  };

  let written = 0;
  /** Modules `/embed` could not render: a failed run, not a smaller one. */
  const missing = [];
  const skipped = [];
  const t0 = Date.now();
  try {
    for (const theme of themes) {
      for (const lang of langs) {
        let fontsChecked = false;
        for (const mode of modes) {
          const dir = path.join(out, theme, mode, lang);
          mkdirSync(dir, { recursive: true });
          const capture = async (url, name) => {
            await page.goto(url);
            await ready();
            if (!fontsChecked) {
              await checkFonts(theme, lang);
              fontsChecked = true;
            }
            const root = page.locator("#embed-root");
            const info = await root.evaluate((el) => ({
              renderable: el.dataset.renderable === "true",
              variant: el.dataset.variant ?? "",
              variants: JSON.parse(el.dataset.variants ?? "[]"),
              axes: JSON.parse(el.dataset.axes ?? "{}"),
              matrix: el.dataset.matrix === "true",
            }));
            if (!info.renderable) return info;
            const file = path.join(dir, `${name(info)}.png`);
            await root.screenshot({ path: file, animations: "disabled" });
            written++;
            console.log(file);
            return info;
          };
          for (const module of modules) {
            const first = await capture(
              embed({ theme, mode, lang, module }),
              (i) => `${module}--${i.variant}`,
            );
            // A module that does not render writes no PNG. Recorded, never passed over: a short
            // set that exits 0 reads as a complete one.
            if (!first.renderable && !missing.includes(module)) missing.push(module);
            if (allVariants) {
              for (const key of first.variants.slice(1)) {
                await capture(
                  embed({ theme, mode, lang, module, variant: key }),
                  () => `${module}--${key}`,
                );
              }
            }
          }
          if (args.parts) {
            for (const section of CATALOG) {
              const info = await capture(
                embed({ theme, mode, lang, demo: section.id }),
                () => `${section.id}--default`,
              );
              if (!info.renderable) {
                if (!skipped.includes(section.id)) skipped.push(section.id);
                continue;
              }
              if (allVariants) {
                for (const key of variantKeys(info.axes, info.matrix)) {
                  await capture(
                    embed({ theme, mode, lang, demo: section.id, variant: key }),
                    () => `${section.id}--${key}`,
                  );
                }
              }
            }
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (skipped.length > 0)
    console.log(`parts with no demo yet (${skipped.length}): ${skipped.join(", ")}`);
  let status = 0;
  if (missing.length > 0) {
    console.error(
      `modules that did not render (no shots were written for them): ${missing.join(", ")}`,
    );
    status = 1;
  }
  if (fontFailures.length > 0) {
    console.error(
      `fonts that did not load (the shots fell back to other faces):\n  ${fontFailures.join("\n  ")}`,
    );
    status = 1;
  }
  if (errors.length > 0) {
    console.error(`page errors:\n  ${[...new Set(errors)].join("\n  ")}`);
    status = 1;
  }
  console.log(`${written} shots in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${out}`);
  return status;
}

/** Every variant key for the axes a demo's embed reports. */
function variantKeys(axes, matrix) {
  let rows = [[]];
  for (const values of Object.values(axes))
    rows = rows.flatMap((row) => values.map((v) => [...row, v]));
  const keys = rows.map((row) => row.join(".")).filter(Boolean);
  return matrix ? ["all", ...keys] : keys;
}

function pngs(root) {
  if (!existsSync(root)) return [];
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".png")) found.push(path.relative(root, full));
    }
  };
  walk(root);
  return found.sort();
}

/** Pixel comparison in the browser: decode both PNGs onto canvases and count the pixels that differ. */
async function diff(before, after) {
  if (!before || !after) {
    console.error("usage: shots.mjs diff <before-dir> <after-dir>");
    return 2;
  }
  const a = pngs(before);
  const b = pngs(after);
  const common = a.filter((file) => b.includes(file));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const moved = [];
  try {
    for (const file of common) {
      const left = readFileSync(path.join(before, file)).toString("base64");
      const right = readFileSync(path.join(after, file)).toString("base64");
      if (left === right) continue;
      const result = await page.evaluate(
        async ({ left, right }) => {
          const load = async (b64) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            return img;
          };
          const [l, r] = await Promise.all([load(left), load(right)]);
          if (l.width !== r.width || l.height !== r.height) {
            return { size: `${l.width}×${l.height} → ${r.width}×${r.height}` };
          }
          const pixels = (img) => {
            const canvas = new OffscreenCanvas(img.width, img.height);
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            return ctx.getImageData(0, 0, img.width, img.height).data;
          };
          const pl = pixels(l);
          const pr = pixels(r);
          let changed = 0;
          for (let i = 0; i < pl.length; i += 4) {
            if (
              Math.abs(pl[i] - pr[i]) > 8 ||
              Math.abs(pl[i + 1] - pr[i + 1]) > 8 ||
              Math.abs(pl[i + 2] - pr[i + 2]) > 8
            ) {
              changed++;
            }
          }
          return { changed, total: pl.length / 4 };
        },
        { left, right },
      );
      if (result.size) moved.push(`${file}  size ${result.size}`);
      else if (result.changed > 0) {
        moved.push(
          `${file}  ${result.changed} px (${((result.changed / result.total) * 100).toFixed(2)}%)`,
        );
      }
    }
  } finally {
    await browser.close();
  }
  const added = b.filter((file) => !a.includes(file));
  const removed = a.filter((file) => !b.includes(file));
  for (const line of moved) console.log(`moved    ${line}`);
  for (const file of added) console.log(`added    ${file}`);
  for (const file of removed) console.log(`removed  ${file}`);
  console.log(
    `${common.length} compared · ${moved.length} moved · ${added.length} added · ${removed.length} removed`,
  );
  return moved.length > 0 ? 1 : 0;
}
