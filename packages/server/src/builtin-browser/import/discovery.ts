/**
 * Finds the browser profiles on this machine that hold cookies or history. A Chromium-family
 * browser names its profiles in `Local State` (`profile.info_cache`: directory → display name);
 * the `Default` and `Profile N` directories count too when that file is missing or stale, and
 * a browser that keeps its only profile in the user-data directory itself (Opera) reads as
 * `Default`. Firefox lists its profiles in `profiles.ini`.
 *
 * A browser installed twice (a distribution package beside a snap or flatpak) can yield the
 * same profile id from two directories — typically one migrated copy of the other. The one
 * whose stores changed most recently is kept: that is the copy in use.
 */
import fs from "node:fs";
import path from "node:path";
import type { BuiltinBrowserImportSource } from "../../api/types.js";
import {
  CHROMIUM_BROWSERS,
  chromiumRoots,
  firefoxRoots,
  type ChromiumBrowser,
} from "./browsers.js";
import type { ImportEnv } from "./index.js";

/** A profile as discovery found it: the DTO plus where its files are. */
export interface DiscoveredProfile {
  source: BuiltinBrowserImportSource;
  /** The profile directory. */
  dir: string;
  /** Chromium: the user-data directory holding `Local State`. Firefox: the profile directory. */
  root: string;
  cookiesFile: string | null;
  historyFile: string | null;
}

const PROFILE_DIR = /^(Default|Profile \d+)$/;

export function discoverProfiles(env: ImportEnv): DiscoveredProfile[] {
  const found = [
    ...CHROMIUM_BROWSERS.flatMap((browser) =>
      chromiumRoots(browser, env).flatMap((root) => chromiumProfiles(browser, root)),
    ),
    ...firefoxRoots(env).flatMap((root) => firefoxProfiles(root)),
  ];
  return newestPerId(found);
}

export function findProfile(sourceId: string, env: ImportEnv): DiscoveredProfile | undefined {
  return discoverProfiles(env).find((p) => p.source.id === sourceId);
}

// ---------------------------------------------------------------------------
// Chromium family
// ---------------------------------------------------------------------------

function chromiumProfiles(browser: ChromiumBrowser, root: string): DiscoveredProfile[] {
  if (!isDirectory(root)) return [];
  const names = profileNames(root);
  const dirs = new Set(names.keys());
  for (const entry of readDir(root)) if (PROFILE_DIR.test(entry)) dirs.add(entry);
  const profiles = [...dirs]
    .sort(byProfileOrder)
    .map((dir) => chromiumProfile(browser, root, dir, path.join(root, dir), names.get(dir)))
    .filter((p): p is DiscoveredProfile => p !== null);
  if (profiles.length > 0) return profiles;
  // Opera's layout: the user-data directory is the one profile.
  const single = chromiumProfile(browser, root, "Default", root, undefined);
  return single === null ? [] : [single];
}

function chromiumProfile(
  browser: ChromiumBrowser,
  root: string,
  profile: string,
  dir: string,
  displayName: string | undefined,
): DiscoveredProfile | null {
  const cookiesFile = firstFile([path.join(dir, "Network", "Cookies"), path.join(dir, "Cookies")]);
  const historyFile = firstFile([path.join(dir, "History")]);
  if (cookiesFile === null && historyFile === null) return null;
  return {
    source: {
      id: `${browser.id}:${profile}`,
      browser: browser.id,
      browserName: browser.name,
      profile,
      profileName: displayName || profile,
      hasCookies: cookiesFile !== null,
      hasHistory: historyFile !== null,
    },
    dir,
    root,
    cookiesFile,
    historyFile,
  };
}

/** `Local State`'s profile directory → display name map; empty when the file is missing or unreadable. */
function profileNames(root: string): Map<string, string> {
  const names = new Map<string, string>();
  const state = readJson(path.join(root, "Local State")) as {
    profile?: { info_cache?: Record<string, { name?: unknown }> };
  } | null;
  for (const [dir, info] of Object.entries(state?.profile?.info_cache ?? {})) {
    // Only plain directory names: the map comes from a file and is joined onto a path.
    if (dir === "" || dir !== path.basename(dir) || dir === "." || dir === "..") continue;
    names.set(dir, typeof info?.name === "string" ? info.name : "");
  }
  return names;
}

/** `Default` first, then `Profile N` by number, then anything else by name. */
function byProfileOrder(a: string, b: string): number {
  const rank = (dir: string): [number, number] => {
    if (dir === "Default") return [0, 0];
    const m = /^Profile (\d+)$/.exec(dir);
    return m ? [1, Number(m[1])] : [2, 0];
  };
  const [ra, na] = rank(a);
  const [rb, nb] = rank(b);
  return ra - rb || na - nb || a.localeCompare(b, "en");
}

// ---------------------------------------------------------------------------
// Firefox
// ---------------------------------------------------------------------------

function firefoxProfiles(root: string): DiscoveredProfile[] {
  const ini = readText(path.join(root, "profiles.ini"));
  if (ini === null) return [];
  const sections = parseIni(ini);
  // The profile an install starts with: `Default=` of an [Install…] section, else Default=1.
  const installDefaults = new Set(
    sections.filter((s) => s.name.startsWith("Install")).map((s) => s.values.Default ?? ""),
  );
  const profiles = sections
    .filter((s) => /^Profile\d+$/.test(s.name) && s.values.Path)
    .map((s) => {
      const rel = s.values.Path!;
      const isDefault = installDefaults.has(rel) || s.values.Default === "1";
      const dir = s.values.IsRelative === "0" ? rel : path.join(root, ...rel.split("/"));
      return { profile: firefoxProfile(dir, s.values.Name), isDefault };
    });
  return [...profiles.filter((p) => p.isDefault), ...profiles.filter((p) => !p.isDefault)].flatMap(
    (p) => (p.profile === null ? [] : [p.profile]),
  );
}

function firefoxProfile(dir: string, name: string | undefined): DiscoveredProfile | null {
  const cookiesFile = firstFile([path.join(dir, "cookies.sqlite")]);
  const historyFile = firstFile([path.join(dir, "places.sqlite")]);
  if (cookiesFile === null && historyFile === null) return null;
  const profile = path.basename(dir);
  return {
    source: {
      id: `firefox:${profile}`,
      browser: "firefox",
      browserName: "Firefox",
      profile,
      profileName: name || profile,
      hasCookies: cookiesFile !== null,
      hasHistory: historyFile !== null,
    },
    dir,
    root: dir,
    cookiesFile,
    historyFile,
  };
}

interface IniSection {
  name: string;
  values: Record<string, string>;
}

function parseIni(text: string): IniSection[] {
  const sections: IniSection[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      sections.push({ name: header[1]!, values: {} });
      continue;
    }
    const eq = line.indexOf("=");
    const section = sections.at(-1);
    if (eq > 0 && section) section.values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Keeps one profile per id: the one whose stores were written most recently. */
function newestPerId(profiles: DiscoveredProfile[]): DiscoveredProfile[] {
  const byId = new Map<string, DiscoveredProfile>();
  for (const profile of profiles) {
    const held = byId.get(profile.source.id);
    if (held === undefined || lastWrite(profile) > lastWrite(held)) {
      byId.set(profile.source.id, profile);
    }
  }
  // Map keeps first-insertion order, so the listing order survives the replacement.
  return [...byId.values()];
}

function lastWrite(profile: DiscoveredProfile): number {
  return Math.max(
    0,
    ...[profile.cookiesFile, profile.historyFile].map((file) =>
      file === null ? 0 : (statOrNull(file)?.mtimeMs ?? 0),
    ),
  );
}

function firstFile(candidates: string[]): string | null {
  return candidates.find((file) => statOrNull(file)?.isFile() === true) ?? null;
}

function isDirectory(dir: string): boolean {
  return statOrNull(dir)?.isDirectory() === true;
}

function statOrNull(file: string): fs.Stats | null {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function readDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function readJson(file: string): unknown {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
