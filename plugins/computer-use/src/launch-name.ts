/**
 * What `launch` accepts: a plain app name, never a path, a script or a bundle given by path.
 *
 * agent-desktop's `launch <APP>` also takes an absolute path on Linux and Windows (and on Linux a
 * bare command looked up on PATH), so a name the Agent writes could start a program it wrote to
 * disk itself — outside every sandbox, as the server's user. So the name is checked here first,
 * on every system:
 *
 * - refused: a `/` or `\`, a drive letter, a leading `~`, `.` or `-`, control characters, and a
 *   name ending in a script or bundle suffix (`.desktop`, `.sh`, `.command`, `.bat`, `.cmd`,
 *   `.ps1`, `.app`; `.exe` everywhere but Windows);
 * - Linux: the name must be an installed app's — the id, the `Name` or the command of a desktop
 *   entry in a system applications directory (each `$XDG_DATA_DIRS/applications`, default
 *   `/usr/local/share` and `/usr/share`), where the file and every directory above it belong to
 *   root and nobody else can write. agent-desktop then gets that entry's absolute path, which it
 *   launches exactly, rather than the name it would also look up on PATH. An entry that is
 *   hidden, not an application, or runs in a terminal is not offered;
 * - Windows: agent-desktop itself resolves a bare name only under System32 and the Windows
 *   directory (`notepad`, `notepad.exe`);
 * - macOS: agent-desktop resolves a display name or bundle ID through Launch Services. That can
 *   include an app in a folder the user can write, such as ~/Applications — a documented gap.
 *
 * Typing into a terminal app that is already allowed stays the documented, accepted risk.
 */
import fs from "node:fs/promises";
import path from "node:path";

/** Suffixes of scripts and bundles: a name ending so names a file, not an installed app. */
const FILE_SUFFIXES = [".desktop", ".sh", ".command", ".bat", ".cmd", ".ps1", ".app"];

/** At most this many entries are read per applications directory. */
const MAX_ENTRIES = 4000;

export type LaunchChoice = { ok: true; app: string } | { ok: false; message: string };

export interface LaunchLookup {
  platform: NodeJS.Platform;
  /** The directories whose `applications/` hold desktop entries, in precedence order (Linux). */
  dataDirs: readonly string[];
  /** Whether a path, and every directory above it, only root can write (tests replace it). */
  trusted?: (file: string) => Promise<boolean>;
}

/** Why `app` is not a plain app name, or null. */
export function launchNameFault(app: string, platform: NodeJS.Platform): string | null {
  const shown = JSON.stringify(app.slice(0, 80));
  if (app.trim() === "" || /[\u0000-\u001f\u007f]/.test(app)) return `${shown} is not an app name`;
  if (/[/\\]/.test(app) || /^[A-Za-z]:/.test(app)) {
    return `${shown} is a path; launch takes an installed app's name`;
  }
  if (/^[~.-]/.test(app)) return `${shown} is a path or an option, not an app name`;
  const lower = app.toLowerCase();
  const suffix = [...FILE_SUFFIXES, ...(platform === "win32" ? [] : [".exe"])].find((s) =>
    lower.endsWith(s),
  );
  if (suffix !== undefined) return `${shown} names a file (${suffix}), not an installed app`;
  return null;
}

/** The directories of `$XDG_DATA_DIRS`, as agent-desktop reads it: the default when unset. */
export function xdgDataDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs = (env.XDG_DATA_DIRS ?? "").split(":").filter((d) => d !== "" && path.isAbsolute(d));
  return dirs.length > 0 ? dirs : ["/usr/local/share", "/usr/share"];
}

/** Whether `file` and every directory above it belong to root and only root can write them. */
export async function rootOnly(file: string): Promise<boolean> {
  let at = path.resolve(file);
  for (;;) {
    let st;
    try {
      st = await fs.stat(at);
    } catch {
      return false;
    }
    if (st.uid !== 0 || (st.mode & 0o022) !== 0) return false;
    const up = path.dirname(at);
    if (up === at) return true;
    at = up;
  }
}

interface DesktopEntry {
  file: string;
  id: string;
  name: string | null;
  command: string | null;
}

/** The `[Desktop Entry]` group's keys of one file, or null for an entry not offered. */
function parseEntry(file: string, id: string, text: string): DesktopEntry | null {
  const keys = new Map<string, string>();
  let inGroup = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inGroup = line === "[Desktop Entry]";
      continue;
    }
    if (!inGroup || line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!keys.has(key)) keys.set(key, line.slice(eq + 1).trim());
  }
  if (keys.get("Type") !== "Application") return null;
  if (keys.get("Hidden") === "true" || keys.get("Terminal") === "true") return null;
  const exec = keys.get("Exec");
  if (exec === undefined || exec === "") return null;
  const words = exec.split(/\s+/).map((w) => w.replace(/^"|"$/g, ""));
  // `env VAR=x prog …` runs prog.
  let i = 0;
  if (path.basename(words[0] ?? "") === "env") {
    i = 1;
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!)) i += 1;
  }
  const program = words[i];
  return {
    file,
    id,
    name: keys.get("Name") ?? null,
    command: program === undefined || program === "" ? null : path.basename(program),
  };
}

/** The desktop entries under one applications directory, ids as XDG forms them (`sub-x`). */
async function entriesUnder(dir: string): Promise<Array<{ file: string; id: string }>> {
  const out: Array<{ file: string; id: string }> = [];
  const walk = async (at: string, prefix: string, depth: number): Promise<void> => {
    let names: import("node:fs").Dirent[];
    try {
      names = await fs.readdir(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      if (out.length >= MAX_ENTRIES) return;
      if (d.isDirectory() && depth < 2) {
        await walk(path.join(at, d.name), `${prefix}${d.name}-`, depth + 1);
      } else if (d.name.endsWith(".desktop")) {
        out.push({ file: path.join(at, d.name), id: `${prefix}${d.name.slice(0, -8)}` });
      }
    }
  };
  await walk(dir, "", 0);
  return out;
}

/**
 * The absolute path of the system desktop entry `name` names — its id (with or without
 * `.desktop`), its command, or its `Name`, compared ignoring case and preferred in that order —
 * or null. The first directory in precedence order that holds a match wins.
 */
export async function linuxDesktopEntry(
  name: string,
  dataDirs: readonly string[],
  trusted: (file: string) => Promise<boolean> = rootOnly,
): Promise<string | null> {
  const want = name.toLowerCase().replace(/\.desktop$/, "");
  const seen = new Set<string>();
  for (const base of dataDirs) {
    const dir = path.join(base, "applications");
    if (!(await trusted(dir))) continue;
    const ranked: Array<{ rank: number; entry: DesktopEntry }> = [];
    for (const { file, id } of await entriesUnder(dir)) {
      // An id an earlier directory already holds is that directory's (XDG precedence).
      if (seen.has(id)) continue;
      seen.add(id);
      let text: string;
      try {
        text = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      const entry = parseEntry(file, id, text);
      if (entry === null) continue;
      const rank =
        entry.id.toLowerCase() === want
          ? 0
          : entry.command?.toLowerCase() === want
            ? 1
            : entry.name?.toLowerCase() === want
              ? 2
              : -1;
      if (rank >= 0) ranked.push({ rank, entry });
    }
    ranked.sort((a, b) => a.rank - b.rank);
    for (const { entry } of ranked) {
      if (await trusted(entry.file)) return entry.file;
    }
  }
  return null;
}

/** What agent-desktop is given for `launch <app>`, or why it is refused. */
export async function resolveLaunch(app: string, lookup: LaunchLookup): Promise<LaunchChoice> {
  const fault = launchNameFault(app, lookup.platform);
  if (fault !== null) return { ok: false, message: `${fault}${HOW[lookup.platform] ?? ""}` };
  if (lookup.platform !== "linux") return { ok: true, app };
  const entry = await linuxDesktopEntry(app, lookup.dataDirs, lookup.trusted);
  if (entry === null) {
    return {
      ok: false,
      message: `no installed app is named ${JSON.stringify(app.slice(0, 80))}${HOW.linux}`,
    };
  }
  return { ok: true, app: entry };
}

/** What each system accepts, said with every refusal. */
const HOW: Partial<Record<NodeJS.Platform, string>> = {
  linux:
    ": on Linux, launch takes an installed app's name — the id, the name or the command of its desktop entry in a system applications directory, such as gnome-calculator, Calculator or org.gnome.Calculator",
  win32:
    ": on Windows, launch takes the name of a program in System32 or the Windows directory, such as notepad",
  darwin:
    ": on macOS, launch takes an app's name or bundle ID, such as Calculator or com.apple.calculator",
};
