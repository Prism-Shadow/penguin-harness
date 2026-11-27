#!/usr/bin/env node
/**
 * Draws the plugin market's covers from the spec (covers.mjs) and writes them out.
 *
 *   node scripts/market-cover-art/build.mjs [--only <id,id>] [--svg <dir>] [--webp]
 *                                           [--community <penguin-harness-community checkout>]
 *
 * --svg <dir>        the vector source of each cover, `<dir>/<id>.svg`
 * --webp             each cover rasterised as the market serves it, `cover.webp` (1280 × 720) and
 *                    `cover-640.webp` (640 × 360), into packages/server/src/plugin/market-covers/<id>/
 *                    for every plugin this build ships: a package under plugins/, or an external
 *                    built-in the server pins (not only plugins/, or the external ones lose theirs)
 * --community <dir>  with --webp, every cover into `<dir>/assets/plugins/<id>/` as well, shipped
 *                    here or not, and each one's `tone` and the document's `updated` date into
 *                    `<dir>/assets/plugins/market.json` (run prettier on it afterwards)
 *
 * Rasterising uses the repository's Playwright Chromium (`pnpm install` first), which encodes the
 * WebP itself. Each cover's field colour is printed as its `tone`.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COVERS } from "./covers.mjs";
import { Art, CX, CY, backdrop, field, palette } from "./kit.mjs";
import { SCENES, emblem, iconOf, lettering, stage } from "./scenes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUNDLED = path.join(ROOT, "packages", "server", "src", "plugin", "market-covers");
/** Each rendition: its file, its size, and its WebP quality as the browser's encoder takes it. */
const SIZES = [
  ["cover.webp", 1280, 720, 0.82],
  ["cover-640.webp", 640, 360, 0.8],
];
/** The most a file may weigh, in bytes: the community repository's check fails past these. */
const BUDGET = { "cover.webp": 150_000, "cover-640.webp": 45_000 };

const TEMPLATES = { stage, emblem, lettering };

/** One cover: its SVG document and its field colour, the `tone` a card shows while it loads. */
export function drawCover(id, spec = COVERS[id]) {
  if (spec === undefined) throw new Error(`covers.mjs has no cover for ${id}`);
  const pal = palette({ h: spec.hue, l: spec.l, c: spec.c });
  const art = new Art(pal);
  const subject =
    spec.template === "scene"
      ? SCENES[id]?.(art, spec)
      : TEMPLATES[spec.template]?.(art, {
          ...spec,
          icon: spec.icon ?? (spec.template === "lettering" ? undefined : iconOf(id)),
        });
  if (subject === undefined) throw new Error(`${id}: no ${spec.template} drawing`);
  // A scene is drawn once and scaled about the centre, so its subject can be sized to the safe
  // area without redrawing it.
  const scale = spec.scale ?? 1;
  const [dx, dy] = spec.shift ?? [0, 0];
  const placed =
    scale === 1 && dx === 0 && dy === 0
      ? subject
      : `<g transform="translate(${CX + dx} ${CY + dy}) scale(${scale}) translate(${-CX} ${-CY})">${subject}</g>`;
  return {
    svg: art.svg([field(art), backdrop(art, spec.backdrop), placed].join(""), id),
    tone: pal.base,
  };
}

/** The plugins this build ships, by folder: packages under plugins/, and the external pins. */
function shippedPlugins() {
  const names = new Set();
  for (const entry of fs.readdirSync(path.join(ROOT, "plugins"), { withFileTypes: true })) {
    const manifest = path.join(ROOT, "plugins", entry.name, "package.json");
    if (entry.isDirectory() && fs.existsSync(manifest)) {
      names.add(JSON.parse(fs.readFileSync(manifest, "utf8")).name);
    }
  }
  const server = JSON.parse(
    fs.readFileSync(path.join(ROOT, "packages", "server", "package.json"), "utf8"),
  );
  for (const [name, source] of Object.entries({
    ...server.dependencies,
    ...server.devDependencies,
  })) {
    if (name.startsWith("@penguinharness/") && !String(source).startsWith("workspace:")) {
      names.add(name);
    }
  }
  return new Set([...names].map((name) => name.replace(/^@penguinharness\//, "")));
}

function parseArgs(argv) {
  const args = { only: null, svg: null, webp: false, community: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") args.only = argv[++i].split(",");
    else if (a === "--svg") args.svg = path.resolve(argv[++i]);
    else if (a === "--webp") args.webp = true;
    else if (a === "--community") args.community = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (args.community !== null && !args.webp) throw new Error("--community needs --webp");
  return args;
}

/** Each SVG drawn at the market's sizes in Chromium and encoded there as WebP: name → bytes. */
async function rasterise(covers) {
  const require = createRequire(path.join(ROOT, "packages", "ui-gallery", "package.json"));
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const out = new Map();
    for (const [id, { svg }] of covers) {
      const files = await page.evaluate(
        async ({ svg, sizes }) => {
          const result = {};
          for (const [name, w, h, quality] of sizes) {
            // Sized in the document itself, so the vector is drawn at the target size, not scaled.
            const sized = svg.replace(/width="\d+" height="\d+"/, `width="${w}" height="${h}"`);
            const img = new Image();
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            result[name] = canvas.toDataURL("image/webp", quality).split(",")[1];
          }
          return result;
        },
        { svg, sizes: SIZES },
      );
      out.set(
        id,
        Object.fromEntries(
          Object.entries(files).map(([name, b64]) => [name, Buffer.from(b64, "base64")]),
        ),
      );
    }
    return out;
  } finally {
    await browser.close();
  }
}

/** The community document with each written cover's tone, dated today. */
function retone(community, tones) {
  const file = path.join(community, "assets", "plugins", "market.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const entry of Object.values(doc.plugins ?? {})) {
    const id = entry.cover?.src?.split("/")[0];
    if (id !== undefined && tones.has(id)) entry.cover.tone = tones.get(id);
  }
  doc.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`market-cover-art: tones and updated -> ${file} (run prettier on it)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ids = args.only ?? Object.keys(COVERS);
  const covers = new Map(ids.map((id) => [id, drawCover(id)]));
  if (args.svg !== null) {
    fs.mkdirSync(args.svg, { recursive: true });
    for (const [id, { svg }] of covers) fs.writeFileSync(path.join(args.svg, `${id}.svg`), svg);
    console.log(`market-cover-art: ${covers.size} SVG files -> ${args.svg}`);
  }
  if (!args.webp) {
    for (const [id, { tone }] of covers) console.log(`${id.padEnd(24)} tone ${tone}`);
    return;
  }

  const shipped = shippedPlugins();
  const rasters = await rasterise(covers);
  // Checked before anything is written, so a cover over budget replaces nothing.
  const over = [...rasters].flatMap(([id, files]) =>
    Object.entries(files)
      .filter(([name, bytes]) => bytes.length > BUDGET[name])
      .map(([name]) => `${id}/${name}`),
  );
  if (over.length > 0) {
    console.error(`market-cover-art: over budget, nothing written: ${over.join(", ")}`);
    process.exit(1);
  }
  let total = 0;
  for (const [id, files] of rasters) {
    const targets = [];
    if (shipped.has(id)) targets.push(path.join(BUNDLED, id));
    if (args.community !== null) targets.push(path.join(args.community, "assets", "plugins", id));
    for (const [name, bytes] of Object.entries(files)) {
      if (shipped.has(id)) total += bytes.length;
      for (const dir of targets) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), bytes);
      }
    }
    const sizes = SIZES.map(([name]) => `${name} ${files[name].length}`).join("  ");
    const where = shipped.has(id) ? "ships here" : "community only";
    console.log(`${id.padEnd(24)} tone ${covers.get(id).tone}  ${sizes}  (${where})`);
  }
  if (args.community !== null) {
    retone(args.community, new Map([...covers].map(([id, { tone }]) => [id, tone])));
  }
  console.log(`market-cover-art: ${total} bytes of covers ship in this build`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
