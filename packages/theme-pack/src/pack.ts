/**
 * A whole pack, checked: the manifest, every stylesheet against the grammar, every font and
 * drawing by its bytes, and the pack's budgets. What comes back is the pack as the server keeps
 * it — the normalised manifest, the re-emitted stylesheets, the binaries as uploaded — plus the
 * one stylesheet the browser loads and the version it is served at. Past the grammar, the
 * stylesheets are held to the clean baseline's static rules the build hands in (ThemeContract's
 * `cleanliness`), with no hit allowed.
 *
 * The served `index.css` wraps the files in the layers the app's stylesheet opened first
 * (`@layer ui-base, ui-theme, ui-accent, ui-font;`): the tokens, the recipes and the section
 * skins in `ui-theme`, over the base; the accent presets in `ui-accent`, over the pack's own dark
 * rules; the `@font-face` rules outside any layer, where layers mean nothing to them. Every `url()`
 * that names a pack file becomes `/api/themes/<id>/files/<path>?v=<v>`. What is kept here holds
 * nothing of the build that serves it: the app sheet's layer order, which the served file opens
 * with, is the server's to prepend when it serves the file (layers.ts).
 *
 * `v` is a digest of the kept files, so the same content always has the same version — an
 * export imported again lands byte for byte — and a replace that changes anything changes it.
 */
import { createHash } from "node:crypto";
import { checkAsset } from "./assets.js";
import { generateCss } from "./css-tree.js";
import { THEME_PACK_LIMITS } from "./limits.js";
import {
  MANIFEST_FILE,
  parseManifest,
  serializeManifest,
  type ThemePackManifest,
} from "./manifest.js";
import { ThemePackError, invalid, tooLarge } from "./problem.js";
import { checkStylesheet, type CheckedSheet, type SheetKind } from "./stylesheet.js";
import { entryKind, type PackFiles } from "./zip.js";

/** What a build's theme API is: its number and its token names. */
export interface ThemeContract {
  /** The theme API this build implements; a pack targeting a higher one is refused. */
  readonly api: number;
  /** The contract's `--ui-*` names, the custom properties a pack may set beside its own. */
  readonly tokens: ReadonlySet<string>;
  /**
   * The clean baseline's static rules (06 「干净的底线」, R1, R2, R5–R11), which a pack is held to
   * with no hit allowed: the UI package's own table (`@prismshadow/penguin-ui/pack-rules`), the one
   * its de-slop suite runs over the built-in packs, handed in by the build so the two cannot
   * drift. `null` checks the grammar alone: the built-in packs predate the rules and the UI suite
   * holds each to the hits it has today.
   */
  readonly cleanliness: CleanlinessRules | null;
}

/** One stylesheet of a pack as the clean-baseline rules read it. */
export interface CleanlinessSource {
  /** The path in the pack. */
  readonly file: string;
  readonly css: string;
  /** The layer the file is served in. */
  readonly layer: string | null;
}

/** What one rule found in one rule of a stylesheet. */
export interface CleanlinessHit {
  /** The rule's code, `R1` … `R11`. */
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly found: string;
}

/** The clean-baseline rules: every hit in a pack's stylesheets, and what each rule says. */
export interface CleanlinessRules {
  readonly hits: (sources: readonly CleanlinessSource[]) => readonly CleanlinessHit[];
  readonly says: Readonly<Record<string, string>>;
}

export interface ValidatedThemePack {
  readonly manifest: ThemePackManifest;
  /** The pack as it is kept, and as its export carries it: no `index.css`. */
  readonly files: PackFiles;
  /** The version the served files are addressed at: hex, 8 characters. */
  readonly v: string;
  /** The stylesheet the browser loads. */
  readonly indexCss: string;
  /** What the pack serves, by path: `index.css`, its fonts and its drawings. */
  readonly served: readonly string[];
}

/** The served stylesheet's name, beside the pack's own files. */
export const INDEX_FILE = "index.css";

/** Where an imported pack's file is served. */
export const servedPath = (id: string, path: string, v: string) =>
  `/api/themes/${id}/files/${path}?v=${v}`;

const utf8 = new TextDecoder("utf-8", { fatal: true });
const encode = (text: string) => new TextEncoder().encode(text);

const sheetKind = (path: string): { kind: SheetKind; hook?: string } => {
  if (path.startsWith("sections/")) return { kind: "section", hook: path.slice(9, -4) };
  return { kind: path.slice(0, -4) as SheetKind };
};

/** Stylesheets in the order the served file layers them: tokens, recipes, skins, then accents. */
const sheetOrder = (path: string) =>
  path === "tokens.css" ? 0 : path === "recipes.css" ? 1 : path.startsWith("sections/") ? 2 : 3;

/** A sheet's text with its pack `url()`s pointing where the server serves them. */
function served(sheet: CheckedSheet, href: (path: string) => string): string {
  const relative = sheet.packUrls.map((url) => url.value);
  for (const url of sheet.packUrls) url.value = href(url.value);
  const css = generateCss(sheet.tree);
  sheet.packUrls.forEach((url, i) => (url.value = relative[i]!));
  return css;
}

/** The digest of the kept files: path, size and bytes of each, in path order. */
function digest(files: PackFiles): string {
  const hash = createHash("sha256");
  for (const path of [...files.keys()].sort()) {
    const bytes = files.get(path)!;
    hash.update(`${path}\0${bytes.byteLength}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex").slice(0, 8);
}

/**
 * Checks a pack's files (from {@link readPackArchive}, or a built-in pack's folder) against
 * `contract`. Throws the first refusal: `invalid` with the file, line and reason; `too_large`
 * past a budget; `api_unsupported` for a pack written against a newer theme API.
 */
export async function validateThemePack(
  files: PackFiles,
  contract: ThemeContract,
): Promise<ValidatedThemePack> {
  const manifestBytes = files.get(MANIFEST_FILE);
  if (manifestBytes === undefined) throw invalid(MANIFEST_FILE, "the pack has no pack.json");
  const manifest = parseManifest(manifestBytes);
  if (manifest.api > contract.api) {
    throw new ThemePackError("api_unsupported", {
      file: MANIFEST_FILE,
      reason: `the pack targets theme API ${manifest.api}; this build implements ${contract.api}`,
    });
  }

  let cssBytes = 0;
  let fontBytes = 0;
  const sheets: string[] = [];
  const assets: string[] = [];
  const docs: string[] = [];
  for (const [path, bytes] of files) {
    const kind = entryKind(path);
    if (kind === null) throw invalid(path, "is not a file a pack may hold");
    if (kind === "stylesheet") {
      sheets.push(path);
      cssBytes += bytes.byteLength;
    } else if (kind === "font" || kind === "art") {
      assets.push(path);
      if (kind === "font") fontBytes += bytes.byteLength;
    } else if (kind === "doc") {
      docs.push(path);
    }
  }
  if (cssBytes > THEME_PACK_LIMITS.cssBytes) {
    throw tooLarge(
      "(stylesheets)",
      `the stylesheets add up to over ${THEME_PACK_LIMITS.cssBytes / 1024} KiB`,
    );
  }
  if (fontBytes > THEME_PACK_LIMITS.fontsBytes) {
    throw tooLarge(
      "fonts/",
      `the fonts add up to over ${THEME_PACK_LIMITS.fontsBytes / 1024 / 1024} MiB`,
    );
  }

  const presets = new Set(manifest.accent.presets.map((preset) => preset.id));
  const paths = new Set(files.keys());
  const dataBytes = { total: 0 };
  const started = performance.now();
  const checked = new Map<string, CheckedSheet>();
  for (const path of sheets.sort((a, b) => sheetOrder(a) - sheetOrder(b) || (a < b ? -1 : 1))) {
    let source: string;
    try {
      source = utf8.decode(files.get(path)!);
    } catch {
      throw invalid(path, "is not UTF-8 text");
    }
    checked.set(
      path,
      checkStylesheet(source, {
        file: path,
        ...sheetKind(path),
        id: manifest.id,
        presets,
        tokens: contract.tokens,
        files: paths,
        dataBytes,
      }),
    );
    if (performance.now() - started > THEME_PACK_LIMITS.parseMs) {
      throw tooLarge(
        path,
        `checking the stylesheets took over ${THEME_PACK_LIMITS.parseMs / 1000} s`,
      );
    }
  }
  const declared = checked.get("accents.css")?.accents ?? new Set<string>();
  const missing = [...presets].find((preset) => !declared.has(preset));
  if (missing !== undefined) {
    throw invalid(
      checked.has("accents.css") ? "accents.css" : MANIFEST_FILE,
      `pack.json lists the accent preset ${missing}, which accents.css does not declare`,
    );
  }

  // The clean baseline reads the stylesheets as the browser will receive them — re-emitted,
  // with nothing a second parser could read another way — in the layers they are served in.
  // `@font-face` rules are faces, not looks, and are not among them.
  if (contract.cleanliness !== null) {
    const sources = [...checked]
      .filter(([path]) => path !== "fonts.css")
      .map(([file, sheet]) => ({
        file,
        css: sheet.css,
        layer: file === "accents.css" ? "ui-accent" : "ui-theme",
      }));
    const [hit] = contract.cleanliness.hits(sources);
    if (hit !== undefined) {
      const says = contract.cleanliness.says[hit.rule] ?? "a clean-baseline rule";
      throw invalid(hit.file, `${hit.rule}, ${says}: ${hit.found}`);
    }
  }

  for (const path of assets.sort()) await checkAsset(path, files.get(path)!);
  for (const path of docs) {
    try {
      utf8.decode(files.get(path)!);
    } catch {
      throw invalid(path, "is not UTF-8 text");
    }
  }

  const kept: PackFiles = new Map();
  kept.set(MANIFEST_FILE, serializeManifest(manifest));
  for (const [path, sheet] of checked) kept.set(path, encode(sheet.css));
  for (const path of [...assets, ...docs]) kept.set(path, files.get(path)!);
  const v = digest(kept);

  const href = (path: string) => servedPath(manifest.id, path, v);
  const layered = (paths: string[]) =>
    paths.map((path) => served(checked.get(path)!, href)).join("");
  const ordered = [...checked.keys()];
  const theme = layered(ordered.filter((path) => sheetOrder(path) < 3));
  const accents = layered(ordered.filter((path) => path === "accents.css"));
  const fonts = layered(ordered.filter((path) => path === "fonts.css"));
  const indexCss =
    fonts +
    (theme === "" ? "" : `@layer ui-theme{${theme}}`) +
    (accents === "" ? "" : `@layer ui-accent{${accents}}`);

  return {
    manifest,
    files: kept,
    v,
    indexCss,
    served: [INDEX_FILE, ...assets.sort()],
  };
}
