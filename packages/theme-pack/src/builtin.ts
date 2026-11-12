/**
 * The built-in packs, as a build carries their sources: what one exports as, and what the base
 * pack says the build's theme contract is.
 *
 * Export of a built-in is the way to start a pack — export Frost, rename it, change a few values,
 * import — so its export is the pack shape an import takes, and the UI package's suite holds every
 * built-in's export form to the same validator an import goes through. Three differences from
 * the folder as the build compiles it:
 *
 * - `index.css` is the build's own (it imports each file into its layer) and stays behind, as does
 *   `fonts.json`, the build's map of the pack's fonts to its hashed assets;
 * - `fonts.css` travels only with the pack's own `fonts/`: a pack whose faces are the app's shared
 *   ones (every face is declared for every theme) exports without it, its tokens naming the
 *   families, and the font files — MiSans among them, which may not be offered on its own — are
 *   not handed out;
 * - the base pack (Frost) writes its values on the bare root and its recipes under
 *   `data-theme-base="modern"`, so every pack starts from them. Exported, its selectors are
 *   scoped to its id like any other pack's, `:root[data-theme="modern"]`, and the person renames
 *   that id with the rest. The rewrite edits the selector text in place, so the export keeps the
 *   source's comments and layout. Its recipes stay behind, and a README says why: a copy built
 *   on `base: "modern"` takes them from the base. So Frost, exported and renamed, imports as it
 *   is. A pack on the foundation alone (Console) exports its recipes, which carry the
 *   clean-baseline hits the built-ins are allowed; an import of it clears them first.
 */
import {
  childrenOf,
  parseCss,
  type CssAtrule,
  type CssAttributeSelector,
  type CssDeclaration,
  type CssNamed,
  type CssNode,
  type CssRule,
} from "./css-tree.js";
import { parseManifest } from "./manifest.js";
import type { ThemeContract } from "./pack.js";
import type { PackFiles } from "./zip.js";

/** The base every pack builds on: Frost. */
export const BASE_PACK_ID = "modern";

/**
 * Ids no import may take: the built-in packs, the one the Doodle round names, and its former id.
 * A server reserves these and whatever packs its own build carries.
 */
export const RESERVED_THEME_IDS: ReadonlySet<string> = new Set([
  "modern",
  "geek",
  "github",
  "doodle",
  "cartoon",
]);

/** The build's map of a pack's fonts to the assets it emitted them as. */
export const FONTS_MAP_FILE = "fonts.json";

const BUILD_ONLY = new Set(["index.css", FONTS_MAP_FILE]);
const SCOPED_SHEETS = /^(?:tokens|recipes|accents)\.css$|^sections\/.+\.css$/;

const quiet = {
  positions: true,
  filename: "",
  parseCustomProperty: true,
  onParseError: () => {},
} as const;

/** `source` with each top-level selector of the base's bare or base-keyed root scoped to `id`. */
export function rescopeBase(source: string, id: string): string {
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: CssNode) => {
    if (node.type === "Rule") {
      for (const selector of childrenOf((node as CssRule).prelude)) {
        const [root, next] = childrenOf(selector);
        if (root?.type !== "PseudoClassSelector" || (root as CssNamed).name !== "root" || !root.loc)
          continue;
        const attribute =
          next?.type === "AttributeSelector" ? (next as CssAttributeSelector) : null;
        if (attribute?.name.name === "data-theme-base" && attribute.loc) {
          edits.push({
            start: root.loc.start.offset,
            end: attribute.loc.end.offset,
            text: `:root[data-theme="${id}"]`,
          });
        } else if (attribute?.name.name !== "data-theme") {
          edits.push({
            start: root.loc.end.offset,
            end: root.loc.end.offset,
            text: `[data-theme="${id}"]`,
          });
        }
      }
      // A nested rule is relative to its parent, which is scoped already.
      return;
    }
    if (node.type === "Atrule") {
      const block = (node as CssAtrule).block;
      if (block !== null) for (const child of childrenOf(block)) visit(child);
    }
  };
  for (const statement of childrenOf(parseCss(source, quiet))) visit(statement);
  let out = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/** What the base pack's export says in its README about the recipes it leaves behind. */
const BASE_EXPORT_NOTE = `## Where the recipes are

This export of Frost carries its token values and accent presets, not its hook recipes. A pack
whose \`pack.json\` says \`"base": "modern"\` takes Frost's recipes from the base, so it needs no
copy of them.

To make it a pack of your own, change \`id\` in \`pack.json\`, and the same id in each
\`:root[data-theme="${BASE_PACK_ID}"]\` selector of \`tokens.css\` and \`accents.css\`. Change
\`names\` and the values you want, then zip the folder and import it.
`;

/**
 * A built-in pack's export form, from its folder as the build carries it (its fonts already
 * resolved from `fonts.json` to `fonts/<path>`).
 *
 * The base pack leaves its `recipes.css` behind, and its README says so: a renamed copy still
 * says `base: "modern"` and takes those recipes from the base, so a copy would add nothing — and
 * the recipes carry the clean-baseline hits the built-ins are allowed and an import is not.
 */
export function builtinExportFiles(id: string, folder: ReadonlyMap<string, Uint8Array>): PackFiles {
  const ownFonts = [...folder.keys()].some((path) => path.startsWith("fonts/"));
  const base = id === BASE_PACK_ID;
  const out: PackFiles = new Map();
  for (const [path, bytes] of [...folder].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (BUILD_ONLY.has(path) || (path === "fonts.css" && !ownFonts)) continue;
    if (base && path === "recipes.css") continue;
    if (base && SCOPED_SHEETS.test(path)) {
      const text = new TextDecoder().decode(bytes);
      out.set(path, new TextEncoder().encode(rescopeBase(text, id)));
    } else {
      out.set(path, bytes);
    }
  }
  if (base) {
    const readme = out.get("README.md");
    const lead = readme === undefined ? "# Frost\n\n" : `${new TextDecoder().decode(readme)}\n`;
    out.set("README.md", new TextEncoder().encode(`${lead}${BASE_EXPORT_NOTE}`));
  }
  return out;
}

/**
 * What a build's base pack says of its theme contract: the API its manifest targets (the UI
 * package's suite holds every built-in to the build's own number) and the `--ui-*` names its
 * tokens declare (the base declares every contract name: it is the fallback for all of them).
 * The clean-baseline rules are code, not data, and the caller adds them.
 */
export function contractOfBase(
  manifest: Uint8Array,
  tokensCss: string,
): Pick<ThemeContract, "api" | "tokens"> {
  const { api } = parseManifest(manifest);
  const tokens = new Set<string>();
  const visit = (node: CssNode) => {
    if (node.type === "Declaration") {
      const { property } = node as CssDeclaration;
      if (property.startsWith("--ui-")) tokens.add(property);
      return;
    }
    for (const child of childrenOf(node)) visit(child);
    const block = (node as Partial<CssRule>).block;
    if (block) visit(block);
  };
  visit(parseCss(tokensCss, quiet));
  return { api, tokens };
}

/** A `fonts.json`: the pack's `fonts/<path>` to the asset the build emitted, both plain paths. */
export function parseFontsMap(bytes: Uint8Array): Map<string, string> {
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${FONTS_MAP_FILE} is not an object`);
  }
  const plain = (path: unknown) =>
    typeof path === "string" &&
    path.split("/").every((segment) => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(segment));
  const out = new Map<string, string>();
  for (const [from, to] of Object.entries(raw)) {
    if (!from.startsWith("fonts/") || !plain(from) || !plain(to)) {
      throw new Error(`${FONTS_MAP_FILE} maps ${JSON.stringify(from)} to ${JSON.stringify(to)}`);
    }
    out.set(from, to as string);
  }
  return out;
}
