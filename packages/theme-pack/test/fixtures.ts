/**
 * Packs for the tests, built in code: a contract, the smallest font that reads as WOFF2, and a
 * Doodle-shaped pack — tokens for both modes with the gray bridge, a pen-line recipe laid as a
 * 9-slice `border-image` of inline PNG and SVG drawings with a `clip-path: shape()` under
 * `@supports`, a forced-colours guard, nesting, a private property, its own keyframes, a section
 * skin with an empty-state drawing, an accent preset and a hand-written face.
 */
import { zipSync } from "fflate";
import type { PackFiles, ThemeContract } from "../src/index.js";

/** The layers a compiled app sheet names, in the order it first names them. */
export const APP_LAYERS = [
  "properties",
  "theme",
  "base",
  "components",
  "utilities",
  "ui-base",
  "ui-theme",
  "ui-accent",
  "ui-font",
];

/** A compiled app sheet in that order, as Tailwind and theme.css leave it. */
export const APP_SHEET =
  "/*! tailwindcss | @layer not-a-layer; */@layer properties{@supports (x:y){*{--tw-x:0}}}" +
  "@layer theme{:root{--color-white:#fff}}@layer base{*{margin:0}}@layer components;" +
  "@layer utilities{.p-1{padding:1px}}@layer ui-base{:root{--ui-canvas:#fafafa}}" +
  "@layer ui-theme{:root[data-theme=x]{--ui-canvas:#eee}}@layer ui-accent{}@layer ui-font{}";

export const CONTRACT: ThemeContract = {
  api: 1,
  tokens: new Set([
    "--ui-canvas",
    "--ui-fg",
    "--ui-accent",
    "--ui-accent-fg",
    "--ui-line",
    "--ui-font-sans",
    "--ui-shadow-md",
  ]),
  // The clean baseline's rules are the UI package's; the server's suite runs them on imports.
  cleanliness: null,
};

const text = (value: string) => new TextEncoder().encode(value);

/** A WOFF2 header and table directory with one untransformed table, and its compressed bytes. */
export function woff2(): Uint8Array {
  const directory = [0x01, 0x36]; // `head` (known tag 1, null transform), 54 bytes
  const data = 10;
  const bytes = new Uint8Array(48 + directory.length + data);
  const view = new DataView(bytes.buffer);
  bytes.set([0x77, 0x4f, 0x46, 0x32], 0); // wOF2
  view.setUint32(4, 0x00010000); // TrueType flavour
  view.setUint32(8, bytes.byteLength);
  view.setUint16(12, 1); // one table
  view.setUint32(16, 200); // totalSfntSize
  view.setUint32(20, data); // totalCompressedSize
  bytes.set(directory, 48);
  return bytes;
}

/** A tiny PNG data URI: the signature and a stub, enough for the grammar, which reads no pixels. */
export const PNG_DATA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";

export const EMPTY_ART =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M4 20c6-8 26-8 32 0" fill="none" stroke="currentColor"/></svg>';

export const DOODLE_MANIFEST = {
  api: 1,
  id: "sketch",
  names: { zh: "草稿", en: "Sketch" },
  version: "1.0.0",
  base: "modern",
  modes: ["light", "dark"],
  swatches: {
    light: { canvas: "#f6f1e7", ink: "#2b2521", accent: "#2b2521" },
    dark: { canvas: "#1c1a17", ink: "#ece4d6", accent: "#ece4d6" },
  },
  accent: {
    own: { light: "#2b2521", dark: "#ece4d6" },
    presets: [{ id: "marker", swatch: "#df6b3c" }],
  },
  fonts: {
    sans: "Sketch Hand",
    ui: "Sketch Hand",
    mono: "JetBrains Mono Variable",
    cjk: "LXGW WenKai GB Screen",
    display: "Sketch Hand",
  },
};

export const DOODLE_TOKENS = `/* Paper, and the pen. */
:root[data-theme="sketch"] {
  --ui-canvas: #f6f1e7;
  --ui-fg: #2b2521;
  --ui-accent: #2b2521;
  --ui-font-sans: "Sketch Hand", "LXGW WenKai GB Screen", sans-serif;
  --color-gray-100: oklch(0.95 0.01 80);
  --_ink: color-mix(in oklab, var(--ui-fg, #2b2521) 80%, transparent);
}
:root[data-theme="sketch"].dark {
  --ui-canvas: #1c1a17;
  --ui-fg: #ece4d6;
  --ui-accent: #ece4d6;
}
`;

export const DOODLE_RECIPES = `@property --_wobble {
  syntax: "<length>";
  inherits: false;
  initial-value: 0px;
}
@media (forced-colors: none) {
  :root[data-theme="sketch"] .ui-edge:not([data-variant="ghost"]) {
    border-image: image-set(url("${PNG_DATA}") 1x, url("${PNG_DATA}") 2x) 9 / 9px / 0 stretch;
    &:hover {
      color: var(--_ink);
    }
  }
  @supports (clip-path: shape(from 0 0, line to 1px 1px)) {
    :root[data-theme="sketch"] .ui-edge {
      clip-path: shape(from 5.76px 0.23px, line to calc(35.95% + 2.53px) -0.1px, close);
    }
  }
  :root[data-theme="sketch"] .ui-glass[role="menu"] > [role^="menuitem"] {
    border-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='52' height='52'%3E%3Crect x='1' y='1' width='50' height='50' rx='5'/%3E%3C/svg%3E") 21 fill / 21px / 12px stretch;
  }
}
:root[data-theme="sketch"] .ui-display:lang(zh) {
  font-weight: 700;
}
:root[data-theme="sketch"] .ui-live[data-state="running"] {
  animation: sketch-scribble 1.2s steps(4) infinite;
}
@keyframes sketch-scribble {
  from { opacity: 1; }
  50% { opacity: 0.6; }
  to { opacity: 1; }
}
`;

export const DOODLE_EMPTY = `:root[data-theme="sketch"] .ui-empty [data-slot="art"] {
  background-image: url("./art/empty.svg");
  background-repeat: no-repeat;
}
`;

export const DOODLE_ACCENTS = `:root[data-theme="sketch"][data-accent="marker"] {
  --ui-accent: #df6b3c;
  --ui-accent-fg: #fff;
}
`;

export const DOODLE_FONTS = `@font-face {
  font-family: "Sketch Hand";
  font-style: normal;
  font-display: swap;
  font-weight: 300 700;
  src: url("fonts/hand.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131;
}
`;

/** The Doodle-shaped pack's files, with `overrides` laid over them (`null` drops a file). */
export function doodlePack(overrides: Record<string, string | Uint8Array | null> = {}): PackFiles {
  const files: Record<string, string | Uint8Array | null> = {
    "pack.json": JSON.stringify(DOODLE_MANIFEST, null, 2),
    "tokens.css": DOODLE_TOKENS,
    "recipes.css": DOODLE_RECIPES,
    "sections/empty.css": DOODLE_EMPTY,
    "accents.css": DOODLE_ACCENTS,
    "fonts.css": DOODLE_FONTS,
    "fonts/hand.woff2": woff2(),
    "art/empty.svg": EMPTY_ART,
    "README.md": "# Sketch\n",
    "LICENSES/hand.txt": "SIL Open Font License 1.1\n",
    ...overrides,
  };
  const out: PackFiles = new Map();
  for (const [path, value] of Object.entries(files)) {
    if (value !== null) out.set(path, typeof value === "string" ? text(value) : value);
  }
  return out;
}

/** `files` zipped, each under `folder` when one is given. */
export function zipOf(files: ReadonlyMap<string, Uint8Array>, folder = ""): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, bytes] of files) entries[`${folder}${path}`] = bytes;
  return zipSync(entries);
}
