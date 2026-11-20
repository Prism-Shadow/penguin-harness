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
 *   `/usr/local/share` and `/usr/share`), where the server's own user — the Agent's, outside the
 *   sandbox — can write neither the file nor any directory above it, nor owns them (a server
 *   running as root: owned by root, and no group or other may write). agent-desktop then gets
 *   that entry's absolute path, which it launches exactly, rather than the name it would also
 *   look up on PATH — and, for that one run, a PATH of only the system directories of the
 *   server's PATH, the entry's own program resolved in one of them (or given by an absolute path
 *   the same rule trusts), so a directory the user can write that comes first on PATH is never
 *   searched. An entry that is hidden, not an application, runs in a terminal, or is a terminal
 *   emulator (category `TerminalEmulator`, or an `X-…Terminal…` one) is not offered. A name
 *   matches an entry's id, its Name, or — only when exactly one entry runs it, and never a shell
 *   or an interpreter such as `sh` or `python3` — its command;
 * - Windows: agent-desktop itself resolves a bare name only under System32 and the Windows
 *   directory (`notepad`, `notepad.exe`);
 * - macOS: agent-desktop resolves a display name or bundle ID through Launch Services. That can
 *   include an app in a folder the user can write, such as ~/Applications — a documented gap.
 *
 * Typing into a terminal app that is already open stays the documented, accepted risk.
 */
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/** Suffixes of scripts and bundles: a name ending so names a file, not an installed app. */
const FILE_SUFFIXES = [".desktop", ".sh", ".command", ".bat", ".cmd", ".ps1", ".app"];

/** At most this many entries are read per applications directory. */
const MAX_ENTRIES = 4000;

/**
 * What agent-desktop is given: the app argument, and on Linux the PATH that run gets — only the
 * system directories of the server's PATH.
 */
export type LaunchChoice =
  { ok: true; app: string; path?: string } | { ok: false; message: string };

export interface LaunchLookup {
  platform: NodeJS.Platform;
  /** The directories whose `applications/` hold desktop entries, in precedence order (Linux). */
  dataDirs: readonly string[];
  /** The server's PATH entries, in order (Linux): the system ones among them are the launch's PATH. */
  pathDirs?: readonly string[];
  /** Whether a path, and every directory above it, is out of the server user's reach (tests replace it). */
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

/**
 * Whether `file` and every directory above it are the system's: the server's user neither owns
 * nor can write any of them, so nobody running as it can put an entry there or change one. A
 * server running as root can write everything, so there each must belong to root with no group
 * or other write.
 */
export async function systemOnly(file: string): Promise<boolean> {
  const uid = process.getuid?.();
  let at = path.resolve(file);
  for (;;) {
    let st;
    try {
      st = await fs.stat(at);
    } catch {
      return false;
    }
    if (uid === 0) {
      if (st.uid !== 0 || (st.mode & 0o022) !== 0) return false;
    } else {
      if (st.uid === uid) return false;
      try {
        await fs.access(at, fsConstants.W_OK);
        return false;
      } catch {
        // Not writable by this user: as it should be.
      }
    }
    const up = path.dirname(at);
    if (up === at) return true;
    at = up;
  }
}

interface DesktopEntry {
  file: string;
  id: string;
  name: string | null;
  /** The program Exec runs, as written: an absolute path or a name looked up on PATH. */
  program: string;
  /** Its base name, for matching; null for a shell or an interpreter, which names no app. */
  command: string | null;
}

/** Programs that run something else: their name says nothing about the app an entry starts. */
const WRAPPERS =
  /^(sh|bash|dash|zsh|ksh|mksh|csh|tcsh|fish|busybox|python[0-9.]*|perl[0-9.]*|ruby[0-9.]*|node|nodejs|lua[0-9.]*|tclsh[0-9.]*|wish[0-9.]*|java)$/;

/** A terminal emulator's categories: `TerminalEmulator`, or a vendor's `X-…Terminal…`. */
function isTerminal(categories: string | undefined): boolean {
  return (categories ?? "")
    .split(";")
    .some((c) => c === "TerminalEmulator" || (/^X-/.test(c) && /terminal/i.test(c)));
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
  if (isTerminal(keys.get("Categories"))) return null;
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
  if (program === undefined || program === "") return null;
  const base = path.basename(program);
  return {
    file,
    id,
    name: keys.get("Name") ?? null,
    program,
    command: WRAPPERS.test(base) ? null : base,
  };
}

/** Where `program` resolves among `dirs` (or itself, when absolute and trusted); null if nowhere. */
async function programIn(
  program: string,
  dirs: readonly string[],
  trusted: (file: string) => Promise<boolean>,
): Promise<string | null> {
  const candidates = path.isAbsolute(program)
    ? [program]
    : program.includes("/")
      ? []
      : dirs.map((d) => path.join(d, program));
  for (const file of candidates) {
    try {
      await fs.access(file, fsConstants.X_OK);
    } catch {
      continue;
    }
    if (await trusted(file)) return file;
  }
  return null;
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
 * The absolute path of the system desktop entry `name` names, or null. Compared ignoring case,
 * preferred in this order: its id (with or without `.desktop`), its command when exactly one
 * entry runs that command, its `Name`; among entries alike, the first directory in precedence
 * order wins. The entry's program must resolve in `pathDirs` (only system directories) or be an
 * absolute path the same rule trusts.
 */
export async function linuxDesktopEntry(
  name: string,
  dataDirs: readonly string[],
  trusted: (file: string) => Promise<boolean> = systemOnly,
  pathDirs: readonly string[] = [],
): Promise<string | null> {
  const want = name.toLowerCase().replace(/\.desktop$/, "");
  const seen = new Set<string>();
  const entries: DesktopEntry[] = [];
  for (const base of dataDirs) {
    const dir = path.join(base, "applications");
    if (!(await trusted(dir))) continue;
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
      if (entry !== null) entries.push(entry);
    }
  }
  const byCommand = entries.filter((e) => e.command?.toLowerCase() === want);
  const ranked = [
    ...entries.filter((e) => e.id.toLowerCase() === want),
    ...(byCommand.length === 1 ? byCommand : []),
    ...entries.filter((e) => e.name?.toLowerCase() === want),
  ];
  for (const entry of ranked) {
    if (!(await trusted(entry.file))) continue;
    if ((await programIn(entry.program, pathDirs, trusted)) === null) continue;
    return entry.file;
  }
  return null;
}

/** The system directories of `dirs`, in order: the only PATH a Linux launch runs with. */
export async function systemPathDirs(
  dirs: readonly string[],
  trusted: (file: string) => Promise<boolean> = systemOnly,
): Promise<string[]> {
  const out: string[] = [];
  for (const d of dirs) {
    if (path.isAbsolute(d) && !out.includes(d) && (await trusted(d))) out.push(d);
  }
  return out;
}

/** What agent-desktop is given for `launch <app>`, or why it is refused. */
export async function resolveLaunch(app: string, lookup: LaunchLookup): Promise<LaunchChoice> {
  const fault = launchNameFault(app, lookup.platform);
  if (fault !== null) return { ok: false, message: `${fault}${HOW[lookup.platform] ?? ""}` };
  if (lookup.platform !== "linux") return { ok: true, app };
  const trusted = lookup.trusted ?? systemOnly;
  const dirs = await systemPathDirs(lookup.pathDirs ?? [], trusted);
  const entry = await linuxDesktopEntry(app, lookup.dataDirs, trusted, dirs);
  if (entry === null) {
    return {
      ok: false,
      message: `no installed app is named ${JSON.stringify(app.slice(0, 80))}${HOW.linux}`,
    };
  }
  return { ok: true, app: entry, path: dirs.join(":") };
}

/** What each system accepts, said with every refusal. */
const HOW: Partial<Record<NodeJS.Platform, string>> = {
  linux:
    ": on Linux, launch takes an installed app's name — the id, the name or the command of its desktop entry in a system applications directory, such as gnome-calculator, Calculator or org.gnome.Calculator; terminal emulators are not offered",
  win32:
    ": on Windows, launch takes the name of a program in System32 or the Windows directory, such as notepad",
  darwin:
    ": on macOS, launch takes an app's name or bundle ID, such as Calculator or com.apple.calculator",
};
