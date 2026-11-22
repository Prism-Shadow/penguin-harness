/**
 * PenguinHarness never operates itself.
 *
 * Without a target, agent-desktop reads and types into the focused window — often PenguinHarness,
 * whose approval dialog a semantic click could press. policy.ts makes every such command name its
 * target; this module decides whether a target's processes belong to PenguinHarness's own process
 * tree, which then refuses the command.
 *
 * The tree's roots are the server process and, in the desktop app (the server is an Electron
 * utility process there), the app's main process — so every window of the desktop app, its
 * built-in browser included, is out of reach, and so are the server's own descendants: the
 * Agents' shells and whatever they started. An app the Agent should operate is started with
 * `penguin computer launch`, whose process does not stay under the server.
 *
 * A process belongs to the tree when it, or any process above it, is a root. The parent links are
 * read from the system: /proc on Linux, `ps` on macOS, CIM through PowerShell on Windows (slow, so
 * a table is kept for a few seconds and read again for a process it does not know). Each row also
 * carries when the process started, where the system says: a parent id that names a process
 * started after its child is a reused id — Windows hands a dead process's id to the next one — and
 * the walk stops there instead of adopting the child into whatever holds that id now. When the
 * table cannot be read, the answer is "cannot tell", which the caller treats as a refusal.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/** One process: its parent's id, and when it started (comparable within one table), if known. */
export interface ProcessRow {
  ppid: number;
  start?: number;
}

/** pid → its row. */
export type ProcessTable = ReadonlyMap<number, ProcessRow>;

/** The roots of PenguinHarness's own tree, as this process sees them. */
export function ownRoots(
  proc: { pid: number; ppid: number; versions: NodeJS.ProcessVersions } = process,
): number[] {
  const roots = [proc.pid];
  if (typeof (proc.versions as Record<string, string | undefined>).electron === "string") {
    roots.push(proc.ppid);
  }
  return roots;
}

/**
 * Whether `pid` is a root or below one in `table`. A parent that started after its child is not
 * its parent (the id was reused), so the walk ends there.
 */
export function belongsToTree(pid: number, roots: readonly number[], table: ProcessTable): boolean {
  const seen = new Set<number>();
  let at: number | undefined = pid;
  while (at !== undefined && at > 0 && !seen.has(at)) {
    if (roots.includes(at)) return true;
    seen.add(at);
    const row = table.get(at);
    if (row === undefined) return false;
    const parent = table.get(row.ppid);
    if (
      parent !== undefined &&
      parent.start !== undefined &&
      row.start !== undefined &&
      parent.start > row.start
    ) {
      return false;
    }
    at = row.ppid;
  }
  return false;
}

function run(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/**
 * The lines `<pid> <ppid> [<start>]` a command printed, as a table. The start is a number (a
 * Windows file time) or a date `ps` prints (`Thu Nov 20 10:00:00 2026`); absent or unreadable, the
 * row has none.
 */
export function parseRows(text: string): Map<number, ProcessRow> {
  const table = new Map<number, ProcessRow>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)(?:\s+(.+?))?\s*$/.exec(line);
    if (!m) continue;
    const raw = m[3];
    const start = raw === undefined ? undefined : /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
    table.set(Number(m[1]), {
      ppid: Number(m[2]),
      ...(start !== undefined && Number.isFinite(start) && start > 0 ? { start } : {}),
    });
  }
  return table;
}

async function linuxTable(): Promise<Map<number, ProcessRow>> {
  const table = new Map<number, ProcessRow>();
  for (const name of await fs.readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = await fs.readFile(path.join("/proc", name, "stat"), "utf8");
      // The command name is parenthesized and may hold spaces; the fields after it are fixed:
      // the parent is the 4th field of the line, the start time (clock ticks since boot) the 22nd.
      const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const start = Number(rest[19]);
      table.set(Number(name), {
        ppid: Number(rest[1]),
        ...(Number.isFinite(start) ? { start } : {}),
      });
    } catch {
      // Gone since the listing.
    }
  }
  return table;
}

/** This machine's process table. */
export async function readProcessTable(
  platform: NodeJS.Platform = process.platform,
): Promise<Map<number, ProcessRow>> {
  if (platform === "linux") return linuxTable();
  if (platform === "darwin") {
    return parseRows(await run("/bin/ps", ["-A", "-o", "pid=,ppid=,lstart="], 10_000));
  }
  if (platform === "win32") {
    const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
    const powershell = path.win32.join(
      root,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    return parseRows(
      await run(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) }",
        ],
        20_000,
      ),
    );
  }
  throw new Error(`no process table on ${platform}`);
}

/**
 * Answers "is this pid ours?" from a table kept for `ttlMs`, read again for a pid it does not
 * hold. `read` is the table's source (readProcessTable; a test's fake).
 */
export class SelfTree {
  private table: { at: number; rows: ProcessTable } | null = null;

  constructor(
    private readonly read: () => Promise<ProcessTable> = () => readProcessTable(),
    private readonly roots: readonly number[] = ownRoots(),
    private readonly ttlMs = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Which of `pids` belong to PenguinHarness's tree; throws when the table cannot be read. */
  async own(pids: readonly number[]): Promise<number[]> {
    if (pids.length === 0) return [];
    const fresh =
      this.table !== null &&
      this.now() - this.table.at < this.ttlMs &&
      pids.every((pid) => this.table!.rows.has(pid));
    if (!fresh) this.table = { at: this.now(), rows: await this.read() };
    return pids.filter((pid) => belongsToTree(pid, this.roots, this.table!.rows));
  }
}
