/**
 * The zip a pack travels in, and the built-in packs' export form.
 *
 * - Given a zip with pack.json inside one top-level folder, it reads as the pack with the folder
 *   stripped; one with pack.json at its root reads as it is.
 * - Given a zip with no pack.json at its root or in its one folder, it is refused.
 * - Given a zip holding a file a pack may not hold (a script, a page, a dotfile, a second JSON) or
 *   a symbolic link, the whole zip is refused, naming the entry.
 * - Given a zip of more than 200 files, an upload past 16 MiB, or entries declaring more than
 *   24 MiB unpacked, it is refused as too large before anything is inflated.
 * - Given an accepted pack exported as a zip and imported again, the kept files are identical and
 *   the version is the same.
 * - Given the base pack's folder (Frost's bare root and base-keyed recipes, the build's
 *   index.css, a fonts.css over the app's shared faces), its export form scopes every rule to its
 *   id with the source's comments kept, leaves the build's files and its recipes behind with a
 *   README beside them (what it says is held by the server's suite, over a real export), and
 *   passes the validator under the contract the base declares; a pack with fonts of its own keeps
 *   them.
 */
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  ThemePackError,
  builtinExportFiles,
  contractOfBase,
  readPackArchive,
  rescopeBase,
  validateThemePack,
  writePackArchive,
} from "../src/index.js";
import { CONTRACT, doodlePack, woff2, zipOf } from "./fixtures.js";

const text = (value: string) => new TextEncoder().encode(value);
const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

function refusalOf(read: () => unknown): ThemePackError {
  try {
    read();
  } catch (err) {
    if (err instanceof ThemePackError) return err;
    throw err;
  }
  throw new Error("the zip was accepted");
}

describe("readPackArchive", () => {
  it("strips the one top-level folder a zip holds the pack in", () => {
    const files = readPackArchive(zipOf(doodlePack(), "sketch/"));
    expect(files.has("pack.json")).toBe(true);
    expect(files.has("fonts/hand.woff2")).toBe(true);
    expect([...files.keys()].some((path) => path.startsWith("sketch/"))).toBe(false);
    expect([...readPackArchive(zipOf(doodlePack())).keys()].sort()).toEqual(
      [...files.keys()].sort(),
    );
  });

  it("refuses a zip with no pack.json at its root or in its one folder", () => {
    const err = refusalOf(() => readPackArchive(zipOf(doodlePack(), "a/b/")));
    expect(err.problem.file).toBe("pack.json");
  });

  it.each([
    ["a script", "theme.js"],
    ["a page", "index.html"],
    ["a dotfile", ".DS_Store"],
    ["a second JSON", "fonts/fonts.json"],
    ["a font in another format", "fonts/hand.woff"],
  ])("refuses a zip holding %s, naming the entry", (_name, entry) => {
    const files = doodlePack();
    files.set(entry, text("x"));
    const err = refusalOf(() => readPackArchive(zipOf(files)));
    expect(err.kind).toBe("invalid");
    expect(err.problem.file).toBe(entry);
  });

  it("refuses a zip holding a symbolic link, naming it", () => {
    const zip = zipSync({
      "pack.json": text("{}"),
      "art/empty.svg": [text("/etc/passwd"), { os: 3, attrs: (0o120777 << 16) >>> 0 }],
    });
    const err = refusalOf(() => readPackArchive(zip));
    expect(err.problem.file).toBe("art/empty.svg");
    expect(err.problem.reason).toContain("symbolic link");
  });

  it("refuses more than 200 files as too large", () => {
    const files = doodlePack();
    for (let i = 0; i < 200; i++) files.set(`art/${i}.png`, new Uint8Array(1));
    expect(refusalOf(() => readPackArchive(zipOf(files))).kind).toBe("too_large");
  });

  it("refuses an upload past 16 MiB as too large without reading it", () => {
    const upload = new Uint8Array(16 * 1024 * 1024 + 1);
    upload.set([0x50, 0x4b, 0x03, 0x04]);
    expect(refusalOf(() => readPackArchive(upload)).kind).toBe("too_large");
  });

  it("refuses entries declaring more than 24 MiB unpacked before inflating them", () => {
    const zip = zipSync({ "pack.json": text("{}"), "art/a.png": new Uint8Array(4) }, { level: 0 });
    // Claim 25 MiB for the second entry in its central directory record, where the caps are read.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let at = zip.byteLength - 22;
    while (view.getUint32(at, true) !== 0x06054b50) at--;
    let entry = view.getUint32(at + 16, true);
    entry +=
      46 +
      view.getUint16(entry + 28, true) +
      view.getUint16(entry + 30, true) +
      view.getUint16(entry + 32, true);
    view.setUint32(entry + 24, 25 * 1024 * 1024, true);
    expect(refusalOf(() => readPackArchive(zip)).kind).toBe("too_large");
  });
});

describe("export and import", () => {
  it("lands an exported pack imported again byte for byte, at the same version", async () => {
    const first = await validateThemePack(
      readPackArchive(zipOf(doodlePack(), "sketch/")),
      CONTRACT,
    );
    const again = await validateThemePack(readPackArchive(writePackArchive(first.files)), CONTRACT);
    expect([...again.files.keys()].sort()).toEqual([...first.files.keys()].sort());
    for (const [path, bytes] of first.files) expect(again.files.get(path), path).toEqual(bytes);
    expect(again.v).toBe(first.v);
  });
});

describe("the built-in packs' export form", () => {
  const BASE_MANIFEST = {
    api: 1,
    id: "modern",
    names: { zh: "白领", en: "Frost" },
    version: "1.0.0",
    base: "modern",
    modes: ["light", "dark"],
    swatches: {
      light: { canvas: "#fafafa", ink: "#232527", accent: "#232527" },
      dark: { canvas: "#1b1c1e", ink: "#e4e4e5", accent: "#f5f5f6" },
    },
    accent: {
      own: { light: "#232527", dark: "#f5f5f6" },
      presets: [{ id: "forest", swatch: "#006838" }],
    },
    fonts: {
      sans: "MiSans",
      ui: "MiSans",
      mono: "JetBrains Mono Variable",
      cjk: "MiSans",
      display: "MiSans",
    },
  };
  const baseFolder = () =>
    new Map<string, Uint8Array>([
      ["pack.json", text(JSON.stringify(BASE_MANIFEST))],
      ["index.css", text('@import "./tokens.css" layer(ui-base);\n')],
      ["fonts.css", text('@import "../../fonts/misans/misans.css";\n')],
      [
        "tokens.css",
        text(
          "/* Frost's values, on the bare root. */\n:root {\n  --ui-canvas: #fafafa;\n  --ui-fg: #232527;\n  --ui-accent: #232527;\n}\n:root.dark {\n  --ui-canvas: #1b1c1e;\n}\n",
        ),
      ],
      [
        "recipes.css",
        text(
          '@media (prefers-reduced-transparency: reduce) {\n  :root[data-theme-base="modern"] .ui-glass { background: var(--ui-canvas); }\n}\n:root[data-theme-base="modern"]:not([data-motion="reduced"]) .ui-stream { color: var(--ui-fg); }\n',
        ),
      ],
      [
        "accents.css",
        text(':root[data-theme="modern"][data-accent="forest"] { --ui-accent: #006838; }\n'),
      ],
    ]);

  it("scopes the base's rules to its id, keeps its comments, and leaves the build's files and its recipes behind", async () => {
    const files = builtinExportFiles("modern", baseFolder());
    expect([...files.keys()].sort()).toEqual([
      "README.md",
      "accents.css",
      "pack.json",
      "tokens.css",
    ]);
    const tokens = decode(files.get("tokens.css"));
    expect(tokens).toContain("/* Frost's values, on the bare root. */");
    expect(tokens).toContain(':root[data-theme="modern"] {');
    expect(tokens).toContain(':root[data-theme="modern"].dark {');
    // A base-keyed recipe, wherever one sits, is scoped to the pack's id the same way.
    expect(rescopeBase(decode(baseFolder().get("recipes.css")), "modern")).toContain(
      ':root[data-theme="modern"]:not([data-motion="reduced"]) .ui-stream',
    );
    const contract = contractOfBase(
      files.get("pack.json")!,
      decode(baseFolder().get("tokens.css")),
    );
    expect(contract.api).toBe(1);
    await expect(
      validateThemePack(files, { ...contract, cleanliness: null }),
    ).resolves.toMatchObject({
      manifest: { id: "modern" },
    });
  });

  it("keeps fonts.css for a pack whose fonts are its own", () => {
    const folder = new Map([
      ["pack.json", text("{}")],
      ["fonts.css", text('@font-face { font-family: "Hand"; src: url("fonts/hand.woff2"); }\n')],
      ["fonts/hand.woff2", woff2()],
    ]);
    expect([...builtinExportFiles("sketch", folder).keys()].sort()).toEqual([
      "fonts.css",
      "fonts/hand.woff2",
      "pack.json",
    ]);
  });
});
