/**
 * Where a machine keeps its things, as the Workspace picker's sidebar wants them: the
 * platform's standard folders as THIS machine resolves them (a Desktop redirected into
 * OneDrive, a `~/桌面` on a Chinese Linux desktop), and the storage locations it offers beside
 * its folders — Windows drives with their labels and kinds, macOS volumes, the Linux root and
 * its mounts. Also the Windows hidden attribute, which no Node API exposes and which Explorer
 * uses to keep `AppData`, `NTUSER.DAT` and the legacy profile junctions out of sight.
 *
 * Everything that touches the platform goes through {@link PlaceEffects}, so the parsers and
 * the decisions run under test on any platform; {@link systemEffects} is the real machine.
 *
 * Two constraints shape every shell-out here. First, a disconnected network drive makes any
 * filesystem call on it block for the redirector's timeout (tens of seconds), and a blocked
 * `fs` call pins one of libuv's four threadpool threads for that long — the whole server's
 * file I/O queues behind it, and a probe "raced against a timeout" still pins the thread after
 * its caller moved on. So nothing in this file touches a drive from this process: enumeration
 * runs in a child (spawning uses no threadpool thread), the child is time-boxed and killed, and
 * whatever it printed before the deadline is kept. Second, the picker's home request waits for
 * this answer, so the whole discovery is cached for a short while, a failure included, and two
 * concurrent requests share one run.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DirLocation, DirStandardFolders } from "../api/types.js";

/** What the home request carries with `places=1`. */
export interface DirPlaces {
  /**
   * Absent when the machine could not be asked (the Windows report ended before it got to
   * the folders), so the picker falls back to matching names in the home listing. Present and
   * empty means the machine was asked and has none of them, and the picker shows none.
   */
  standardFolders?: DirStandardFolders;
  locations: DirLocation[];
}

/** One child process run to completion or to its deadline. */
export interface ExecOutcome {
  /** What the child wrote before it exited or was killed — bytes, because `cmd /u` writes UTF-16LE. */
  stdout: Buffer;
  /** The exit code; null when the child was killed or never started. */
  code: number | null;
  /** True when the child outlived its budget and was killed; `stdout` is what it had printed by then. */
  timedOut: boolean;
  /** Set when the child could not be started at all (the command is not on the machine). */
  failed?: string;
}

/** A directory entry as `readdir` records it, without a stat: the two kinds this file asks about. */
export interface PlaceDirent {
  name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** The machine as discovery sees it; tests inject one, production uses {@link systemEffects}. */
export interface PlaceEffects {
  platform: string;
  homedir: string;
  env: Record<string, string | undefined>;
  readFile(file: string): Promise<string>;
  readdir(dir: string): Promise<PlaceDirent[]>;
  readlink(file: string): Promise<string>;
  /** False for anything that is not a directory, a missing path included. */
  isDirectory(file: string): Promise<boolean>;
  /**
   * Runs a child without a shell and without the threadpool, killing it at `timeoutMs`.
   * `verbatim` hands the arguments to Windows unquoted, for a `cmd.exe` command line whose
   * quoting this file controls itself.
   */
  exec(
    file: string,
    args: string[],
    opts: { timeoutMs: number; verbatim?: boolean },
  ): Promise<ExecOutcome>;
}

/**
 * The discovery's shelf life. Long enough that reopening the picker, or two of its requests
 * landing together, never spawn PowerShell twice; short enough that a USB drive plugged in
 * shows up on the next open.
 */
export const PLACES_CACHE_TTL_MS = 15_000;
/**
 * PowerShell's budget. A cold `powershell.exe` takes one to three seconds on a slow laptop or
 * a CI runner; a budget it routinely blew would make the fallback the normal path. The script
 * prints one JSON line per fact, so a run that hits the deadline still yields everything it
 * had said by then.
 */
export const POWERSHELL_TIMEOUT_MS = 5_000;
/** `cmd.exe` budgets: the drive-letter probe and the hidden-attribute listing. */
export const CMD_TIMEOUT_MS = 3_000;
/** More than any directory listing or drive report; past it the child is killed and ignored. */
const OUTPUT_CAP_BYTES = 16 * 1024 * 1024;

export function systemEffects(): PlaceEffects {
  return {
    platform: process.platform,
    homedir: os.homedir(),
    env: process.env,
    readFile: (file) => fs.readFile(file, "utf8"),
    readdir: (dir) => fs.readdir(dir, { withFileTypes: true }),
    readlink: (file) => fs.readlink(file),
    isDirectory: (file) =>
      fs.stat(file).then(
        (st) => st.isDirectory(),
        () => false,
      ),
    exec: runChild,
  };
}

/**
 * Collects a child's stdout until it exits or runs out of time. stdin and stderr are not even
 * opened: nothing here reads a diagnostic (`dir`'s "File Not Found" is localized), and a pipe
 * nobody drains could block the child. On the deadline the child is killed and the promise
 * settles on `close`, or one second later if a grandchild inherited the pipe and keeps it open.
 */
function runChild(
  file: string,
  args: string[],
  opts: { timeoutMs: number; verbatim?: boolean },
): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let backstop: NodeJS.Timeout | undefined;
    const settle = (code: number | null, failed?: string) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (backstop !== undefined) clearTimeout(backstop);
      resolve({
        stdout: Buffer.concat(chunks),
        code,
        timedOut,
        ...(failed !== undefined ? { failed } : {}),
      });
    };
    let child: ChildProcess;
    try {
      child = spawn(file, args, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        windowsVerbatimArguments: opts.verbatim === true,
      });
    } catch (err) {
      settle(null, (err as Error).message);
      return;
    }
    const kill = () => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    };
    timer = setTimeout(() => {
      timedOut = true;
      kill();
      backstop = setTimeout(() => settle(null), 1_000);
    }, opts.timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > OUTPUT_CAP_BYTES) {
        kill();
        settle(null, "output too large");
        return;
      }
      chunks.push(chunk);
    });
    child.on("error", (err) => settle(null, err.message));
    child.on("close", (code) => settle(code));
  });
}

// ---------------------------------------------------------------------------------------------
// The cached discovery

/** Place discovery with its cache; one per machine, built once for the server by {@link discoverLocalPlaces}. */
export function createPlaceDiscovery(
  effects: PlaceEffects,
  opts: { ttlMs?: number; now?: () => number } = {},
): { discover(): Promise<DirPlaces> } {
  const ttl = opts.ttlMs ?? PLACES_CACHE_TTL_MS;
  const now = opts.now ?? Date.now;
  let cached: { at: number; value: DirPlaces } | null = null;
  let inFlight: Promise<DirPlaces> | null = null;
  return {
    discover() {
      if (cached !== null && now() - cached.at < ttl) return Promise.resolve(cached.value);
      if (inFlight !== null) return inFlight;
      inFlight = discoverPlaces(effects)
        .then((value) => {
          cached = { at: now(), value };
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}

let local: { discover(): Promise<DirPlaces> } | null = null;

/** The places of the machine this server runs on, cached. Never rejects. */
export function discoverLocalPlaces(): Promise<DirPlaces> {
  local ??= createPlaceDiscovery(systemEffects());
  return local.discover();
}

/**
 * One uncached discovery. Never rejects: a platform whose every source failed still answers
 * with the root (or the system drive), and leaves the folders unanswered for the picker to
 * find by name, which is what it showed before places existed.
 */
export async function discoverPlaces(effects: PlaceEffects): Promise<DirPlaces> {
  try {
    if (effects.platform === "win32") return await windowsPlaces(effects);
    if (effects.platform === "darwin") return await darwinPlaces(effects);
    if (effects.platform === "linux") return await linuxPlaces(effects);
  } catch {
    // Fall through to the bare answer.
  }
  return {
    locations:
      effects.platform === "win32" ? knownWindowsDrives(effects) : [{ path: "/", kind: "root" }],
  };
}

// ---------------------------------------------------------------------------------------------
// Standard folders by their English names (macOS, and the fallback everywhere)

const FIXED_FOLDERS: ReadonlyArray<[keyof DirStandardFolders, string]> = [
  ["desktop", "Desktop"],
  ["documents", "Documents"],
  ["downloads", "Downloads"],
  ["pictures", "Pictures"],
];

/** `~/Desktop` and friends, those that exist. The path flavour follows the DESCRIBED platform, not the host's. */
async function fixedStandardFolders(effects: PlaceEffects): Promise<DirStandardFolders> {
  const flavour = effects.platform === "win32" ? path.win32 : path.posix;
  const found: DirStandardFolders = {};
  await Promise.all(
    FIXED_FOLDERS.map(async ([key, name]) => {
      const full = flavour.join(effects.homedir, name);
      if (await effects.isDirectory(full)) found[key] = full;
    }),
  );
  return found;
}

// ---------------------------------------------------------------------------------------------
// Linux

const NETWORK_FSTYPES = new Set([
  "nfs",
  "nfs4",
  "cifs",
  "smb3",
  "smbfs",
  "sshfs",
  "fuse.sshfs",
  "fuse.rclone",
  "davfs",
  "fuse.davfs2",
  "afs",
  "ceph",
  "fuse.ceph",
  "glusterfs",
  "fuse.glusterfs",
  "ncpfs",
  "coda",
  "afp",
  "fuse.afpfs",
]);

/** Kernel bookkeeping that happens to be mounted under a user prefix (WSL puts a tmpfs at /mnt/wsl). */
const PSEUDO_FSTYPES = new Set([
  "tmpfs",
  "devtmpfs",
  "proc",
  "sysfs",
  "cgroup",
  "cgroup2",
  "binfmt_misc",
  "debugfs",
  "tracefs",
  "securityfs",
  "pstore",
  "bpf",
  "configfs",
  "fusectl",
  "mqueue",
  "hugetlbfs",
  "devpts",
  "nsfs",
  "rpc_pipefs",
]);

/** The filesystems WSL mounts a Windows drive with: WSL1 `drvfs`, WSL2 `9p`, and their newer spellings. */
const WSL_DRIVE_FSTYPES = new Set(["9p", "drvfs", "v9fs", "virtiofs"]);

/** Where Linux desktops and admins mount things a person would browse to. */
const MOUNT_PREFIXES = ["/media/", "/run/media/", "/mnt/"];

/** `/proc/mounts` escapes a space as `\040`, a tab `\011`, a newline `\012` and a backslash `\134`. */
function unescapeMountField(field: string): string {
  return field.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

/**
 * The browsable mounts in a `/proc/self/mounts` text, in path order: those under
 * {@link MOUNT_PREFIXES}, minus WSL's own plumbing (`/mnt/wsl*`, `/mnt/wslg`), pseudo
 * filesystems, and a mount nested under another listed one (a bind mount inside a disk is the
 * disk's business). The same mount point listed twice keeps the later row: a systemd automount
 * shows its `autofs` trigger and, once mounted, the real filesystem at the same path.
 */
export function parseMounts(text: string): DirLocation[] {
  const byPath = new Map<string, { fstype: string }>();
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 3) continue;
    const mountPoint = unescapeMountField(fields[1] ?? "");
    const fstype = fields[2] ?? "";
    if (!MOUNT_PREFIXES.some((prefix) => mountPoint.startsWith(prefix))) continue;
    if (/^\/mnt\/wslg?(\/|$)/.test(mountPoint)) continue;
    if (PSEUDO_FSTYPES.has(fstype)) continue;
    byPath.set(mountPoint, { fstype });
  }
  // Code-unit order, so a mount point always precedes anything nested under it.
  const sorted = [...byPath.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const kept: DirLocation[] = [];
  for (const [mountPoint, { fstype }] of sorted) {
    if (kept.some((k) => mountPoint.startsWith(`${k.path}/`))) continue;
    kept.push(mountLocation(mountPoint, fstype));
  }
  return kept;
}

function mountLocation(mountPoint: string, fstype: string): DirLocation {
  const name = path.posix.basename(mountPoint);
  if (NETWORK_FSTYPES.has(fstype)) return { path: mountPoint, kind: "network", label: name };
  const wslDrive = /^\/mnt\/([A-Za-z])$/.exec(mountPoint);
  if (wslDrive !== null && WSL_DRIVE_FSTYPES.has(fstype)) {
    return { path: mountPoint, kind: "drive", label: `${wslDrive[1]?.toUpperCase()}:` };
  }
  if (mountPoint.startsWith("/media/") || mountPoint.startsWith("/run/media/")) {
    return { path: mountPoint, kind: "removable", label: name };
  }
  return { path: mountPoint, kind: "volume", label: name };
}

const XDG_KEYS: ReadonlyArray<[keyof DirStandardFolders, string]> = [
  ["desktop", "XDG_DESKTOP_DIR"],
  ["documents", "XDG_DOCUMENTS_DIR"],
  ["downloads", "XDG_DOWNLOAD_DIR"],
  ["pictures", "XDG_PICTURES_DIR"],
];

/**
 * The four folders as `user-dirs.dirs` configures them: `XDG_DESKTOP_DIR="$HOME/桌面"` lines,
 * `$HOME` expanded. A value that is the home directory itself is how the spec says "this
 * folder is disabled", and comes back as null; a key the file does not mention is absent.
 */
export function parseUserDirs(
  text: string,
  home: string,
): Partial<Record<keyof DirStandardFolders, string | null>> {
  const found: Partial<Record<keyof DirStandardFolders, string | null>> = {};
  const homeNorm = home.replace(/\/+$/, "") || "/";
  for (const line of text.split("\n")) {
    const match = /^\s*(XDG_[A-Z]+_DIR)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
    if (match === null) continue;
    const key = XDG_KEYS.find(([, name]) => name === match[1])?.[0];
    if (key === undefined) continue;
    const value = (match[2] ?? "").replace(/^\$\{?HOME\}?/, homeNorm).replace(/\/+$/, "") || "/";
    found[key] = value === homeNorm ? null : value;
  }
  return found;
}

/**
 * Linux standard folders: what `user-dirs.dirs` names, where it exists; the English name where
 * the file says nothing; nothing where the file disables the folder.
 */
async function linuxStandardFolders(effects: PlaceEffects): Promise<DirStandardFolders> {
  const configHome = effects.env.XDG_CONFIG_HOME || path.posix.join(effects.homedir, ".config");
  let configured: Partial<Record<keyof DirStandardFolders, string | null>> = {};
  try {
    configured = parseUserDirs(
      await effects.readFile(path.posix.join(configHome, "user-dirs.dirs")),
      effects.homedir,
    );
  } catch {
    // No file: the English names below.
  }
  const found: DirStandardFolders = {};
  await Promise.all(
    FIXED_FOLDERS.map(async ([key, name]) => {
      const chosen = key in configured ? configured[key] : path.posix.join(effects.homedir, name);
      if (chosen !== null && chosen !== undefined && (await effects.isDirectory(chosen))) {
        found[key] = chosen;
      }
    }),
  );
  return found;
}

async function linuxPlaces(effects: PlaceEffects): Promise<DirPlaces> {
  let mounts: DirLocation[] = [];
  try {
    mounts = parseMounts(await effects.readFile("/proc/self/mounts"));
  } catch {
    // A sandbox without /proc still has a root to offer.
  }
  return {
    standardFolders: await linuxStandardFolders(effects),
    locations: [{ path: "/", kind: "root" }, ...mounts],
  };
}

// ---------------------------------------------------------------------------------------------
// macOS

/**
 * The volumes under `/Volumes`, the startup disk first. Since Catalina the startup disk is a
 * symlink there (`/Volumes/Macintosh HD -> /`), which is how it gets its name; `/` leads even
 * when no entry links to it, so the picker's root always has a target. Only the directory
 * listing and the link targets are read — a network volume whose server is gone is a plain
 * directory entry of `/Volumes` until something touches it. Dot-names and Time Machine's
 * `com.apple.TimeMachine.localsnapshots` are not volumes a person would pick.
 */
export async function darwinLocations(effects: PlaceEffects): Promise<DirLocation[]> {
  let startup: DirLocation = { path: "/", kind: "volume" };
  const others: DirLocation[] = [];
  let entries: PlaceDirent[] = [];
  try {
    entries = await effects.readdir("/Volumes");
  } catch {
    // No /Volumes at all: the root alone.
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name.startsWith("com.apple.")) continue;
    const full = `/Volumes/${entry.name}`;
    if (entry.isSymbolicLink()) {
      let target: string;
      try {
        target = path.posix.resolve("/Volumes", await effects.readlink(full));
      } catch {
        continue;
      }
      if (target === "/") startup = { path: "/", kind: "volume", label: entry.name };
      continue;
    }
    if (entry.isDirectory()) others.push({ path: full, kind: "volume", label: entry.name });
  }
  others.sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
  return [startup, ...others];
}

async function darwinPlaces(effects: PlaceEffects): Promise<DirPlaces> {
  const [locations, standardFolders] = await Promise.all([
    darwinLocations(effects),
    fixedStandardFolders(effects),
  ]);
  return { standardFolders, locations };
}

// ---------------------------------------------------------------------------------------------
// Windows

/**
 * The drive and known-folder report, one JSON object per line, written as raw UTF-8 bytes.
 *
 * Raw bytes because Windows PowerShell's redirected output otherwise uses the OEM code page,
 * and its `ConvertTo-Json` leaves non-ASCII as is — a volume labelled 「U 盘」 would arrive
 * garbled. One object per line because the parser then keeps whatever arrived before the
 * deadline, and because `ConvertTo-Json` on a collection of one yields an object, not an array.
 *
 * Drives are enumerated with `GetLogicalDrives` (a bitmask) and `DriveInfo.DriveType` (the DOS
 * device table) rather than `Win32_LogicalDisk`: WMI reads size and free space from every
 * disk, which on a disconnected mapped drive is the redirector round-trip this whole file
 * avoids, and a cold WMI call also starts its provider host. A label is read only from a local
 * drive that says it is ready (an empty card reader throws); a network drive is named by its
 * share, from the persistent mappings in the registry and then the redirector's own list, and
 * never by a volume label that would have to come from the server. Constrained Language Mode
 * forbids `New-Object` on .NET types, so that branch falls back to WMI without network drives.
 *
 * Folders come last: `Test-Path` on a Documents folder redirected to a dead share blocks, and
 * put last it costs the folders alone. Downloads has no `SpecialFolder` member; its known
 * folder id is read from the shell's registry key.
 */
const WINDOWS_REPORT_SCRIPT =
  String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$stdout = [Console]::OpenStandardOutput()
function Emit($value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $value -Compress -Depth 3) + "` +
  "`n" +
  String.raw`")
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}
$network = @()
try {
  foreach ($root in [IO.Directory]::GetLogicalDrives()) {
    try {
      $drive = New-Object -TypeName IO.DriveInfo -ArgumentList $root
      $type = [int]$drive.DriveType
      if ($type -eq 4) { $network += $root; continue }
      $label = $null
      try { if ($drive.IsReady) { $label = $drive.VolumeLabel } } catch {}
      Emit @{ drive = $root; type = $type; label = $label }
    } catch {}
  }
} catch {
  try {
    foreach ($disk in @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType <> 4' -ErrorAction Stop)) {
      Emit @{ drive = ($disk.DeviceID + '\'); type = [int]$disk.DriveType; label = $disk.VolumeName }
    }
  } catch {}
  try { $network = @(Get-ChildItem -LiteralPath 'HKCU:\Network' -ErrorAction Stop | ForEach-Object { $_.PSChildName + ':\' }) } catch {}
}
foreach ($root in $network) {
  $letter = $root.Substring(0, 1)
  $share = $null
  try { $share = (Get-ItemProperty -LiteralPath "HKCU:\Network\$letter" -ErrorAction Stop).RemotePath } catch {}
  if (-not $share) {
    try {
      $drives = (New-Object -ComObject WScript.Network).EnumNetworkDrives()
      for ($i = 0; $i -lt $drives.Count; $i += 2) {
        if ($drives.Item($i) -ieq ($letter + ':')) { $share = $drives.Item($i + 1) }
      }
    } catch {}
  }
  Emit @{ drive = $root; type = 4; share = $share }
}
$folders = @{}
foreach ($pair in @(@('desktop', 'Desktop'), @('documents', 'MyDocuments'), @('pictures', 'MyPictures'))) {
  try {
    $dir = [Environment]::GetFolderPath($pair[1])
    if ($dir -and (Test-Path -LiteralPath $dir -PathType Container)) { $folders[$pair[0]] = $dir }
  } catch {}
}
try {
  $shell = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction Stop
  $downloads = $shell.'{374DE290-123F-4565-9164-39C4925E467B}'
  if (-not $downloads) { $downloads = Join-Path $env:USERPROFILE 'Downloads' }
  $downloads = [Environment]::ExpandEnvironmentVariables($downloads)
  if (Test-Path -LiteralPath $downloads -PathType Container) { $folders['downloads'] = $downloads }
} catch {}
Emit @{ folders = $folders }
`;

/**
 * The script travels base64-encoded (UTF-16LE, what `-EncodedCommand` takes), so no character
 * in it meets the command line's quoting rules. Exported for the test that pins the arguments.
 */
export const POWERSHELL_ARGS: readonly string[] = [
  "-NoProfile",
  "-NonInteractive",
  "-NoLogo",
  "-ExecutionPolicy",
  "Bypass",
  "-EncodedCommand",
  Buffer.from(WINDOWS_REPORT_SCRIPT, "utf16le").toString("base64"),
];

/** Resolved from the system root so the desktop app's PATH, which users do break, is not relied on. */
function powershellPath(env: PlaceEffects["env"]): string {
  const root = env.SystemRoot ?? env.windir;
  return root
    ? path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

function cmdPath(env: PlaceEffects["env"]): string {
  return env.ComSpec ?? "cmd.exe";
}

/** One drive line of the report, after normalization. */
export interface WindowsDrive {
  /** `C:\` */
  root: string;
  /** `System.IO.DriveType` and `Win32_LogicalDisk.DriveType` share the numbering: 2 removable, 3 fixed, 4 network, 5 CD-ROM, 6 RAM. */
  type: number;
  label?: string;
  /** A network drive's `\\server\share`. */
  share?: string;
}

export interface WindowsReport {
  /** Null until the report's folders line arrived: the script prints it last, after the drives. */
  folders: DirStandardFolders | null;
  drives: WindowsDrive[];
}

/** `C:`, `c:\`, `C:\Users` → `C:\`; null for anything that does not start with a drive letter. */
function driveRoot(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^([A-Za-z]):/.exec(value);
  return match === null ? null : `${match[1]?.toUpperCase()}:\\`;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * The report's lines, each a JSON object (or an array of them), everything else skipped: a
 * line PowerShell's host printed on its own, or one cut short by the deadline.
 */
export function parseWindowsReport(text: string): WindowsReport {
  const report: WindowsReport = { folders: null, drives: [] };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) absorbReportItem(report, item);
  }
  return report;
}

function absorbReportItem(report: WindowsReport, item: unknown): void {
  if (typeof item !== "object" || item === null) return;
  const record = item as Record<string, unknown>;
  const folders = record.folders;
  if (typeof folders === "object" && folders !== null) {
    const found: DirStandardFolders = report.folders ?? {};
    for (const [key] of FIXED_FOLDERS) {
      const value = nonEmpty((folders as Record<string, unknown>)[key]);
      if (value !== undefined) found[key] = value;
    }
    report.folders = found;
  }
  const root = driveRoot(record.drive);
  if (root === null) return;
  const type = typeof record.type === "number" ? record.type : Number(record.type);
  const label = nonEmpty(record.label);
  const share = nonEmpty(record.share);
  report.drives.push({
    root,
    type: Number.isFinite(type) ? type : 0,
    ...(label !== undefined ? { label } : {}),
    ...(share !== undefined ? { share } : {}),
  });
}

function driveKind(type: number): DirLocation["kind"] {
  if (type === 2) return "removable";
  if (type === 4) return "network";
  if (type === 5) return "optical";
  return "drive";
}

/**
 * The drives as This PC lists them: local drives by letter, then network drives by letter. A
 * drive is named by its volume label when it has one; a network drive otherwise by its share —
 * Explorer shows `media (\\nas)`, and the server behind a dead mapping is never asked for a
 * label, so the share is what a network drive normally carries.
 */
export function windowsLocations(drives: readonly WindowsDrive[]): DirLocation[] {
  const unique = [...new Map(drives.map((d): [string, WindowsDrive] => [d.root, d])).values()];
  const byLetter = (a: WindowsDrive, b: WindowsDrive) => a.root.localeCompare(b.root);
  const locals = unique.filter((d) => d.type !== 4).sort(byLetter);
  const networks = unique.filter((d) => d.type === 4).sort(byLetter);
  return [...locals, ...networks].map((d) => {
    const label = d.label ?? d.share;
    return { path: d.root, kind: driveKind(d.type), ...(label !== undefined ? { label } : {}) };
  });
}

/** `cmd /u` writes UTF-16LE without a BOM; a child killed mid-character leaves an odd byte to drop. */
export function decodeCmdOutput(stdout: Buffer): string {
  return stdout.subarray(0, stdout.length - (stdout.length % 2)).toString("utf16le");
}

const DRIVE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * Drive letters without PowerShell: `if exist X:\` for each letter, inside a `cmd.exe` we can
 * kill. A dead network mapping blocks the loop at its letter; the letters printed before the
 * deadline are kept, and the probe pins a thread of the child's, not one of ours.
 */
async function probeDriveLetters(effects: PlaceEffects): Promise<DirLocation[]> {
  const probe = await effects.exec(
    cmdPath(effects.env),
    ["/d", "/u", "/c", `for %d in (${DRIVE_LETTERS.join(" ")}) do @if exist %d:\\ echo %d:`],
    { timeoutMs: CMD_TIMEOUT_MS, verbatim: true },
  );
  const roots = new Set<string>();
  for (const line of decodeCmdOutput(probe.stdout).split(/\r?\n/)) {
    const root = /^[A-Za-z]:$/.test(line.trim()) ? driveRoot(line.trim()) : null;
    if (root !== null) roots.add(root);
  }
  return [...roots].sort().map((root): DirLocation => ({ path: root, kind: "drive" }));
}

/** What is known without asking anything: the system drive and the one holding the home directory. */
function knownWindowsDrives(effects: PlaceEffects): DirLocation[] {
  const roots = new Set<string>();
  for (const candidate of [effects.env.SystemDrive, effects.homedir]) {
    const root = driveRoot(candidate);
    if (root !== null) roots.add(root);
  }
  return [...roots].sort().map((root): DirLocation => ({ path: root, kind: "drive" }));
}

async function windowsPlaces(effects: PlaceEffects): Promise<DirPlaces> {
  const run = await effects.exec(powershellPath(effects.env), [...POWERSHELL_ARGS], {
    timeoutMs: POWERSHELL_TIMEOUT_MS,
  });
  const report = parseWindowsReport(run.stdout.toString("utf8"));
  let locations = windowsLocations(report.drives);
  if (locations.length === 0) locations = await probeDriveLetters(effects);
  if (locations.length === 0) locations = knownWindowsDrives(effects);
  // A report cut short before its folders line leaves the folders unanswered rather than
  // guessed: the picker then finds them by name, as it did before.
  return {
    locations,
    ...(report.folders !== null ? { standardFolders: report.folders } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// The Windows hidden attribute

/**
 * Names Explorer hides in a profile or a drive root, for a listing whose attributes could not be
 * read: the profile's own files, the legacy junctions (hidden and access-denied, so a click on
 * one only fails), and the system's root-level folders.
 */
const HIDDEN_BY_CONVENTION = new Set(
  [
    "AppData",
    "Application Data",
    "Cookies",
    "Local Settings",
    "My Documents",
    "NetHood",
    "PrintHood",
    "Recent",
    "SendTo",
    "Start Menu",
    "Templates",
    "ntuser.ini",
    "desktop.ini",
    "Thumbs.db",
    "Documents and Settings",
    "System Volume Information",
    "pagefile.sys",
    "hiberfil.sys",
    "swapfile.sys",
    "DumpStack.log.tmp",
    "bootmgr",
    "BOOTNXT",
    "Config.Msi",
  ].map((n) => n.toLowerCase()),
);

/** The curated fallback: finding-7 names anywhere, `ntuser.dat*`, and `$`-prefixed names in a drive root. */
export function conventionallyHiddenNames(dir: string, names: readonly string[]): Set<string> {
  const atRoot = /^[A-Za-z]:\\?$/.test(dir);
  return new Set(
    names.filter((name) => {
      const lower = name.toLowerCase();
      return (
        HIDDEN_BY_CONVENTION.has(lower) ||
        lower.startsWith("ntuser.dat") ||
        (atRoot && name.startsWith("$"))
      );
    }),
  );
}

/**
 * Which of `names` in `dir` carry the hidden attribute, as `dir /a:h /b` reports them — the
 * attribute Explorer's default view hides (system-only items it shows, and every item Explorer
 * hides in a profile is hidden, so one attribute and one process suffice). `/u` makes the
 * output UTF-16LE whatever the console code page, `/d` keeps AutoRun commands out of it.
 *
 * The directory is an argument rather than the child's working directory because a mapped
 * drive's realpath is a UNC path, and cmd.exe started in a UNC directory warns and silently
 * runs in the Windows directory instead — wrong names with a clean exit. A path can hold no
 * `"`, so the quoting is safe; a segment spelled `%NAME%` after a variable that exists is the
 * one shape cmd mangles, and that folder's entries come back unmarked.
 *
 * `dir` exits 1 when nothing matched ("File Not Found", localized, on the stderr nobody reads),
 * so exit 1 with nothing printed means no hidden entries. Anything else — no cmd.exe, a
 * deadline, an unexpected exit — falls back to {@link conventionallyHiddenNames}.
 */
export async function windowsHiddenNames(
  dir: string,
  names: readonly string[],
  effects: PlaceEffects = systemEffects(),
): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  const run = await effects.exec(
    cmdPath(effects.env),
    ["/d", "/u", "/c", "dir", "/a:h", "/b", `"${dir}"`],
    { timeoutMs: CMD_TIMEOUT_MS, verbatim: true },
  );
  const usable =
    run.failed === undefined &&
    !run.timedOut &&
    (run.code === 0 || (run.code === 1 && run.stdout.length === 0));
  if (!usable) return conventionallyHiddenNames(dir, names);
  const listed = new Set(
    decodeCmdOutput(run.stdout)
      .split(/\r?\n/)
      .map((line) => line.replace(/^\uFEFF/, ""))
      .filter((line) => line !== ""),
  );
  return new Set(names.filter((name) => listed.has(name)));
}
