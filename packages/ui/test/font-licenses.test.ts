/**
 * Every font the package ships carries its licence (A-architecture §5).
 *
 * The fonts are bundled into the Web App's `dist/` — and from there into the server tarball and the
 * desktop app — so the OFL's condition travels with them: the licence text has to ship beside the
 * font files. The package mirrors each font dependency's licence into `src/fonts/LICENSES/`
 * (`scripts/sync-font-licenses.mjs`), and the Vite plugin emits that directory into every consumer's
 * build. What decays is the mirror: a font added without its text, a text left behind after its
 * font was dropped, a copy that no longer matches the package it came from, or a `@font-face` that
 * names a file the package does not have. Each is checked here.
 *
 * Naming: a dependency `@fontsource[-variable]/<family>` mirrors to `LICENSES/<family>.txt`, the
 * text normalized the way the sync script writes it (LF endings, no trailing spaces, one final
 * newline).
 *
 * Fonts arrive as dependencies, with one exception the manifest `src/fonts/vendored-fonts.json`
 * declares: a font with no package (MiSans) is vendored as woff2 slices in its own directory, and its
 * licence is the licensor's own text, transcribed into `LICENSES/` by hand and naming its title. Any
 * other font binary checked into the package is refused, and a TTF or OTF is refused everywhere — the
 * package never carries a whole font file that could be offered on its own.
 *
 * Until the package ships a font, the checks have nothing to hold and say so as a skipped case.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { scanSourceRoots, stripCssComments } from "../src/testing";
import { PACKAGE_DIR, REPO_ROOT, SRC_DIR } from "./helpers/paths";

const FONTS_DIR = join(SRC_DIR, "fonts");
const LICENSES_DIR = join(FONTS_DIR, "LICENSES");
const NODE_MODULES = join(PACKAGE_DIR, "node_modules");
const FONT_PACKAGE = /^@fontsource(?:-variable)?\/([a-z0-9-]+)$/;
const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i;
/** The licences a bundled font may carry. */
const KNOWN_LICENSE = /SIL OPEN FONT LICENSE|Apache License|Permission is hereby granted/i;
const LICENSE_FILES = ["LICENSE", "LICENSE.txt", "LICENSE.md", "OFL.txt"];

/** An entry of `src/fonts/vendored-fonts.json`: a font with no package, cut into the package. */
interface VendoredFont {
  readonly family: string;
  /** Package-relative directory holding its woff2 slices, ending in `/`. */
  readonly files: string;
  /** Package-relative path of its licence text, under `src/fonts/LICENSES/`. */
  readonly license: string;
  /** The licence's title; the text must contain it. */
  readonly licenseTitle: string;
}
const VENDORED_MANIFEST = join(FONTS_DIR, "vendored-fonts.json");
const vendoredManifest: readonly VendoredFont[] = existsSync(VENDORED_MANIFEST)
  ? Object.values(
      JSON.parse(readFileSync(VENDORED_MANIFEST, "utf8")) as Record<string, VendoredFont>,
    )
  : [];
const vendoredLicenseNames = new Set(vendoredManifest.map((font) => basename(font.license)));
/** The vendored font a package-relative path belongs to, if it sits in one's slice directory. */
const vendoredFontOf = (rel: string) => vendoredManifest.find((font) => rel.startsWith(font.files));

const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const fontDependencies = Object.keys(manifest.dependencies ?? {}).filter((name) =>
  FONT_PACKAGE.test(name),
);
const family = (dependency: string) => FONT_PACKAGE.exec(dependency)![1]!;

interface FontReference {
  /** The stylesheet's repo-relative id. */
  readonly file: string;
  /** As written in `url()` or `@import`. */
  readonly specifier: string;
  /** The npm package the reference lands in (`@fontsource-variable/geist`); null for our own files. */
  readonly dependency: string | null;
  /** Absolute path of the target inside the installed package; null for our own files. */
  readonly target: string | null;
}

/**
 * Every `url()` and `@import` in the fonts CSS, placed: a bare `@scope/name/…` specifier, or a
 * relative path that climbs into `node_modules/@scope/name/…`, lands in that package; a relative
 * path to one of our own sheets lands in none.
 */
function fontReferences(): FontReference[] {
  if (!existsSync(FONTS_DIR)) return [];
  const scan = scanSourceRoots({ fonts: FONTS_DIR }, { repoRoot: REPO_ROOT, extensions: [".css"] });
  const refs: FontReference[] = [];
  const place = (file: { id: string; path: string }, specifier: string) => {
    if (specifier.startsWith("data:")) return;
    const bare = specifier.startsWith(".") ? null : /^(@[^/]+\/[^/]+)/.exec(specifier)?.[1];
    if (bare !== null) {
      refs.push({
        file: file.id,
        specifier,
        dependency: bare ?? null,
        target: bare === undefined ? null : join(NODE_MODULES, specifier),
      });
      return;
    }
    const target = resolve(dirname(file.path), specifier.replace(/[?#].*$/, ""));
    const [scope, name] = relative(NODE_MODULES, target).split(sep);
    const dependency =
      scope !== undefined && scope.startsWith("@") && name !== undefined
        ? `${scope}/${name}`
        : null;
    refs.push({
      file: file.id,
      specifier,
      dependency,
      target: dependency === null ? null : target,
    });
  };
  for (const file of scan.files) {
    const css = stripCssComments(file.text);
    for (const m of css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)) place(file, m[2]!.trim());
    for (const m of css.matchAll(/@import\s+(["'])([^"']+)\1/g)) place(file, m[2]!.trim());
  }
  return refs;
}

/** Font binaries checked into the package itself (node_modules excluded), package-relative with `/`. */
function fontBinaries(dir = PACKAGE_DIR, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) fontBinaries(path, out);
    else if (FONT_FILE.test(name)) out.push(relative(PACKAGE_DIR, path).split(sep).join("/"));
  }
  return out;
}

/** The licence file inside an installed dependency, or undefined. */
function installedLicense(dependency: string): string | undefined {
  const dir = join(NODE_MODULES, dependency);
  const file = LICENSE_FILES.map((name) => join(dir, name)).find((path) => existsSync(path));
  return file === undefined ? undefined : readFileSync(file, "utf8");
}

/** The sync script's normalization: LF endings, no trailing spaces, one final newline. */
const normalize = (text: string) =>
  `${text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()}\n`;

describe("font licences", () => {
  const references = fontReferences();
  const binaries = fontBinaries();
  const mirrored = existsSync(LICENSES_DIR)
    ? readdirSync(LICENSES_DIR).filter((name) => name.endsWith(".txt"))
    : [];
  const shipsFonts =
    fontDependencies.length > 0 ||
    references.some((ref) => ref.dependency !== null) ||
    binaries.length > 0 ||
    mirrored.length > 0;

  if (!shipsFonts) {
    it.skip("src/fonts — PENDING, the package ships no font yet: licences not checked", () => {});
    return;
  }

  it("are mirrored for every font dependency", () => {
    const missing = fontDependencies
      .filter((dependency) => !mirrored.includes(`${family(dependency)}.txt`))
      .map((dependency) => `${dependency} → src/fonts/LICENSES/${family(dependency)}.txt`);
    expect(missing, "Run `pnpm --filter @prismshadow/penguin-ui sync:font-licenses`.").toEqual([]);
  });

  it("are not kept for fonts the package no longer depends on or vendors", () => {
    const families = new Set(fontDependencies.map(family));
    expect(
      mirrored.filter(
        (name) => !families.has(name.replace(/\.txt$/, "")) && !vendoredLicenseNames.has(name),
      ),
    ).toEqual([]);
  });

  it("match the licence each dependency ships, and are a licence a bundled font may carry", () => {
    const problems: string[] = [];
    for (const dependency of fontDependencies) {
      const copy = join(LICENSES_DIR, `${family(dependency)}.txt`);
      if (!existsSync(copy)) continue; // reported above
      const text = readFileSync(copy, "utf8");
      if (!KNOWN_LICENSE.test(text)) problems.push(`${dependency}: not a recognised font licence`);
      const upstream = installedLicense(dependency);
      if (upstream === undefined) {
        problems.push(`${dependency}: no licence file in the installed package`);
      } else if (normalize(upstream) !== text) {
        problems.push(`${dependency}: the mirrored text has drifted from the package's own`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("name their licence for every vendored font, beside the slices they cover", () => {
    const problems: string[] = [];
    for (const font of vendoredManifest) {
      if (!font.files.endsWith("/") || !existsSync(join(PACKAGE_DIR, font.files))) {
        problems.push(`${font.family}: files "${font.files}" is not a directory of the package`);
      } else if (
        !fontBinaries().some((rel) => rel.startsWith(font.files) && rel.endsWith(".woff2"))
      ) {
        problems.push(`${font.family}: ${font.files} holds no woff2 slice — drop the entry`);
      }
      if (dirname(join(PACKAGE_DIR, font.license)) !== LICENSES_DIR) {
        problems.push(
          `${font.family}: ${font.license} is outside src/fonts/LICENSES/, so no build ships it`,
        );
      } else if (!existsSync(join(PACKAGE_DIR, font.license))) {
        problems.push(`${font.family}: ${font.license} is missing`);
      } else {
        const text = readFileSync(join(PACKAGE_DIR, font.license), "utf8");
        if (!text.includes(font.licenseTitle)) {
          problems.push(`${font.family}: ${font.license} does not name ${font.licenseTitle}`);
        }
        if (normalize(text) !== text) {
          problems.push(`${font.family}: ${font.license} is not whitespace-normalized`);
        }
      }
      if (
        fontDependencies.some(
          (dependency) => `${family(dependency)}.txt` === basename(font.license),
        )
      ) {
        problems.push(`${font.family}: ${basename(font.license)} is also a dependency's mirror`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("cover every font the stylesheets load, which must exist in its package", () => {
    const problems: string[] = [];
    for (const { file, specifier, dependency, target } of references) {
      if (dependency === null) {
        // One of our own files: a sheet, or a vendored font's slice.
        if (!FONT_FILE.test(specifier.replace(/[?#].*$/, ""))) continue;
        const sheet = join(REPO_ROOT, file);
        const rel = relative(PACKAGE_DIR, resolve(dirname(sheet), specifier.replace(/[?#].*$/, "")))
          .split(sep)
          .join("/");
        if (vendoredFontOf(rel) === undefined) {
          problems.push(`${file}: ${specifier} is a font file of no vendored font`);
        } else if (!existsSync(join(PACKAGE_DIR, rel))) {
          problems.push(`${file}: ${specifier} does not exist`);
        }
        continue;
      }
      if (!fontDependencies.includes(dependency)) {
        problems.push(`${file}: ${specifier} is from ${dependency}, not a font dependency`);
      } else if (!mirrored.includes(`${family(dependency)}.txt`)) {
        problems.push(`${file}: ${specifier} is from ${dependency}, whose licence is not mirrored`);
      } else if (target === null || !existsSync(target)) {
        problems.push(`${file}: ${specifier} does not exist in the installed package`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("finds the font files the stylesheets load — the scan is exercised on the real sheets", () => {
    // A reference pattern that stopped matching would pass the check above over nothing.
    expect(references.filter((ref) => ref.dependency !== null).length).toBeGreaterThan(0);
  });

  it("arrive as dependencies or as a vendored font's woff2 slices, never as other binaries", () => {
    expect(
      binaries.filter((rel) => !(rel.endsWith(".woff2") && vendoredFontOf(rel) !== undefined)),
      "A font binary in the package must be a woff2 slice under a vendored-fonts.json entry's " +
        "files directory; a TTF or OTF is never checked in.",
    ).toEqual([]);
  });
});
