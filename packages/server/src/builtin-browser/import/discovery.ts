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
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
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

export async function discoverProfiles(env: ImportEnv): Promise<DiscoveredProfile[]> {
  const found: DiscoveredProfile[] = [];
  for (const browser of CHROMIUM_BROWSERS) {
    for (const root of chromiumRoots(browser, env)) {
      found.push(...(await chromiumProfiles(browser, root)));
    }
  }
  for (const root of firefoxRoots(env)) found.push(...(await firefoxProfiles(root)));
  return newestPerId(found);
}

export async function findProfile(
  sourceId: string,
  env: ImportEnv,
): Promise<DiscoveredProfile | undefined> {
  return (await discoverProfiles(env)).find((p) => p.source.id === sourceId);
}

// ---------------------------------------------------------------------------
// Chromium family
// ---------------------------------------------------------------------------

async function chromiumProfiles(
  browser: ChromiumBrowser,
  root: string,
): Promise<DiscoveredProfile[]> {
  if (!(await isDirectory(root))) return [];
  const names = await profileNames(root);
  const dirs = new Set(names.keys());
  for (const entry of await readDir(root)) if (PROFILE_DIR.test(entry)) dirs.add(entry);
  const profiles: DiscoveredProfile[] = [];
  for (const dir of [...dirs].sort(byProfileOrder)) {
    const profile = await chromiumProfile(browser, root, dir, path.join(root, dir), names.get(dir));
    if (profile !== null) profiles.push(profile);
  }
  if (profiles.length > 0) return profiles;
  // Opera's layout: the user-data directory is the one profile.
  const single = await chromiumProfile(browser, root, "Default", root, undefined);
  return single === null ? [] : [single];
}

async function chromiumProfile(
  browser: ChromiumBrowser,
  root: string,
  profile: string,
  dir: string,
  displayName: string | undefined,
): Promise<DiscoveredProfile | null> {
  const cookiesFile = await firstFile([
    path.join(dir, "Network", "Cookies"),
    path.join(dir, "Cookies"),
  ]);
  const historyFile = await firstFile([path.join(dir, "History")]);
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
async function profileNames(root: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const state = (await readJson(path.join(root, "Local State"))) as {
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

async function firefoxProfiles(root: string): Promise<DiscoveredProfile[]> {
  const ini = await readText(path.join(root, "profiles.ini"));
  if (ini === null) return [];
  const sections = parseIni(ini);
  // The profile an install starts with: `Default=` of an [Install…] section, else Default=1.
  const installDefaults = new Set(
    sections.filter((s) => s.name.startsWith("Install")).map((s) => s.values.Default ?? ""),
  );
  const profiles: Array<{ profile: DiscoveredProfile | null; isDefault: boolean }> = [];
  for (const section of sections.filter((s) => /^Profile\d+$/.test(s.name) && s.values.Path)) {
    const rel = section.values.Path!;
    const isDefault = installDefaults.has(rel) || section.values.Default === "1";
    const dir = section.values.IsRelative === "0" ? rel : path.join(root, ...rel.split("/"));
    profiles.push({ profile: await firefoxProfile(dir, section.values.Name), isDefault });
  }
  return [...profiles.filter((p) => p.isDefault), ...profiles.filter((p) => !p.isDefault)].flatMap(
    (p) => (p.profile === null ? [] : [p.profile]),
  );
}

async function firefoxProfile(
  dir: string,
  name: string | undefined,
): Promise<DiscoveredProfile | null> {
  const cookiesFile = await firstFile([path.join(dir, "cookies.sqlite")]);
  const historyFile = await firstFile([path.join(dir, "places.sqlite")]);
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
async function newestPerId(profiles: DiscoveredProfile[]): Promise<DiscoveredProfile[]> {
  const byId = new Map<string, DiscoveredProfile>();
  for (const profile of profiles) {
    const held = byId.get(profile.source.id);
    if (held === undefined || (await lastWrite(profile)) > (await lastWrite(held))) {
      byId.set(profile.source.id, profile);
    }
  }
  // Map keeps first-insertion order, so the listing order survives the replacement.
  return [...byId.values()];
}

async function lastWrite(profile: DiscoveredProfile): Promise<number> {
  return Math.max(
    0,
    ...(await Promise.all(
      [profile.cookiesFile, profile.historyFile].map(async (file) =>
        file === null ? 0 : ((await statOrNull(file))?.mtimeMs ?? 0),
      ),
    )),
  );
}

async function firstFile(candidates: string[]): Promise<string | null> {
  for (const file of candidates) {
    if ((await statOrNull(file))?.isFile() === true) return file;
  }
  return null;
}

async function isDirectory(dir: string): Promise<boolean> {
  return (await statOrNull(dir))?.isDirectory() === true;
}

async function statOrNull(file: string): Promise<Stats | null> {
  try {
    return await fs.stat(file);
  } catch {
    return null;
  }
}

async function readDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function readJson(file: string): Promise<unknown> {
  const text = await readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
