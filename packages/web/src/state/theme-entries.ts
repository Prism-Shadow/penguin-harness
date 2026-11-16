/**
 * The themes the app knows, as one list: the built-in packs the build ships, in the registry's
 * order, then the packs an admin imported on this server, in the order they were installed
 * (lib/account-sync/theme-packs.ts). Each entry carries what the picker, the accent swatches and
 * the pack rows read of it, whichever kind it is.
 *
 * Pure — no React, no `window` — so the pages and the provider read one answer to "what is this
 * theme" and a test can feed it a list.
 */
import type { ThemePackDto } from "@prismshadow/penguin-server/api";
import {
  BUILTIN_PACKS,
  INITIAL_THEME_ID,
  THEME_API,
  builtinPack,
  isThemeId,
  type ThemeBase,
  type ThemeModeName,
  type ThemePackManifest,
  type ThemePackSwatch,
} from "@prismshadow/penguin-ui";
import { themePackHref } from "@prismshadow/penguin-ui/boot";
import { S } from "../lib/strings";
import type { Locale } from "./locale";

export interface ThemeEntry {
  readonly id: string;
  /** The manifest's own names; a built-in pack's name is the app's dictionary's ({@link themeName}). */
  readonly names: { readonly zh: string; readonly en: string };
  readonly version: string;
  readonly base: ThemeBase;
  readonly swatches: Readonly<Record<ThemeModeName, ThemePackSwatch>>;
  readonly accent: {
    readonly own: Readonly<Record<ThemeModeName, string>>;
    readonly presets: ReadonlyArray<{ readonly id: string; readonly swatch: string }>;
  };
  /** Shipped with the build: in the bundled stylesheet, its id reserved, never removed. */
  readonly builtin: boolean;
  /**
   * Where an imported pack's stylesheet is served, built from its id and version as the pre-paint
   * script builds it (never the address the list carries); null for a built-in pack.
   */
  readonly href: string | null;
  /** Written for a theme API this build implements: it can be picked and loaded. */
  readonly loadable: boolean;
}

/** The manifest fields every entry carries, from a built-in manifest or an imported pack. */
function described(pack: ThemePackManifest | ThemePackDto) {
  const { id, names, version, base, swatches, accent } = pack;
  return { id, names, version, base, swatches, accent };
}

function builtinEntry(pack: ThemePackManifest): ThemeEntry {
  return { ...described(pack), builtin: true, href: null, loadable: true };
}

function importedEntry(pack: ThemePackDto): ThemeEntry {
  return {
    ...described(pack),
    builtin: false,
    href: themePackHref(pack.id, pack.v),
    loadable: pack.api <= THEME_API,
  };
}

/**
 * Every theme: the built-in packs, then the imported ones. An imported entry that reuses a
 * built-in id (the server refuses one, so only a garbled cache could hold it) is left out.
 */
export function themeEntries(installed: readonly ThemePackDto[]): ThemeEntry[] {
  return [
    ...BUILTIN_PACKS.map(builtinEntry),
    ...installed.filter((pack) => !isThemeId(pack.id)).map(importedEntry),
  ];
}

/**
 * The theme an id names, for showing it: a built-in pack, or an imported pack this build can load.
 * Anything else — a pack since removed, one written for a newer build — is the theme a browser
 * starts in, as the stored choice reads (theme-prefs.ts).
 */
export function shownTheme(id: string, installed: readonly ThemePackDto[]): ThemeEntry {
  if (isThemeId(id)) return builtinEntry(builtinPack(id));
  const pack = installed.find((p) => p.id === id);
  if (pack !== undefined && pack.api <= THEME_API) return importedEntry(pack);
  return builtinEntry(builtinPack(INITIAL_THEME_ID));
}

/** A theme's name in the interface's language. */
export function themeName(entry: ThemeEntry, locale: Locale): string {
  if (isThemeId(entry.id)) return S.settings.themeNames[entry.id];
  return entry.names[locale] || entry.names.en;
}
