/**
 * Theme packs (PRFC-0026): a folder with a manifest, imported as a zip by an admin and picked by
 * every account on the server; any pack, built-in or imported, exports to the same zip.
 *
 * This package is the shared code: the manifest, the CSS grammar and the checks a pack is held to,
 * the zip it travels in, and the built-in packs' export form. The server runs it at import; the
 * UI package's suite runs the same validator over the built-in packs, so a built-in can never do
 * what an import may not.
 */
export { THEME_PACK_LIMITS } from "./limits.js";
export { ThemePackError, type ThemePackProblem, type ThemePackRefusal } from "./problem.js";
export {
  MANIFEST_FILE,
  THEME_PACK_ID,
  parseManifest,
  serializeManifest,
  type ThemePackBase,
  type ThemePackManifest,
  type ThemePackMode,
} from "./manifest.js";
export {
  entryKind,
  readPackArchive,
  writePackArchive,
  type EntryKind,
  type PackFiles,
} from "./zip.js";
export {
  INDEX_FILE,
  servedPath,
  validateThemePack,
  type CleanlinessHit,
  type CleanlinessRules,
  type CleanlinessSource,
  type ThemeContract,
  type ValidatedThemePack,
} from "./pack.js";
export { layerOrder, layerStatement, servedVersion } from "./layers.js";
export {
  BASE_PACK_ID,
  FONTS_MAP_FILE,
  RESERVED_THEME_IDS,
  builtinExportFiles,
  contractOfBase,
  parseFontsMap,
  rescopeBase,
} from "./builtin.js";
