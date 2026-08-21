/**
 * Listen-port probing for command sessions — the fallback behind output scanning (see
 * service-url.ts): a server that prints no URL can still be found by asking the OS which
 * ports the session's process group / process tree is listening on.
 *
 * Per platform, using only stock tooling:
 * - linux: `ps -o pid= -g <pgid>` for the group's pids (the session leader is the group,
 *   see ManagedSession's `detached` spawn) + `ss -ltnp` for listening sockets with owner
 *   pids (iproute2; unprivileged output covers the user's own processes, which the
 *   session's children are);
 * - darwin: `lsof -a -g <pgid> -iTCP -sTCP:LISTEN -n -P -Fpn` — lsof filters by process
 *   group itself and `-F` output is machine-readable;
 * - win32: PowerShell `Get-NetTCPConnection -State Listen` + `Get-CimInstance
 *   Win32_Process` as one JSON payload; the tree is walked from the session's root pid
 *   (no process groups on Windows — same ancestry rule the kill path's `taskkill /t`
 *   uses).
 *
 * Probes are best-effort and bounded: one short-lived child process with a hard timeout,
 * every failure (missing tool, non-zero exit, unparseable output) collapsing to null —
 * "don't know", distinct from "no listeners" (an empty list), so callers keep a
 * previously known URL over a transient failure. The pure parsers are exported for
 * fixture tests; only the linux path gets a live integration test.
 */
import { execFile } from "node:child_process";

/** Hard cap (ms) on one probe child process: the poll path must never hang on a stuck tool. */
const PROBE_TIMEOUT_MS = 1_500;

/** One listening socket attributed to a pid. */
export interface ListenSocket {
  port: number;
  pid: number;
}

/** `ps -o pid= -g <pgid>` output → the group's pids (one per line, whitespace-padded). */
export function parsePsPids(output: string): number[] {
  const pids: number[] = [];
  for (const line of output.split("\n")) {
    const n = Number.parseInt(line.trim(), 10);
    if (Number.isInteger(n) && n > 0) pids.push(n);
  }
  return pids;
}

/**
 * `ss -ltnp` output → listening sockets with their owner pids. A line reads
 * `LISTEN 0 511 *:5173 *:* users:(("node",pid=123,fd=23),("node",pid=124,fd=23))`;
 * the local-address column's port suffix and every `pid=` in the users list are taken
 * (a socket shared by a forked pair lists them all).
 */
export function parseSsListenPorts(output: string): ListenSocket[] {
  const sockets: ListenSocket[] = [];
  for (const line of output.split("\n")) {
    // Columns: State Recv-Q Send-Q Local:Port Peer:Port Process — the header row and any
    // non-listen state fail the first-column check.
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== "LISTEN" || cols.length < 4) continue;
    const addr = /:(\d{1,5})$/.exec(cols[3]!);
    const port = addr ? Number.parseInt(addr[1]!, 10) : NaN;
    if (!Number.isInteger(port) || port <= 0) continue;
    for (const m of line.matchAll(/pid=(\d+)/g)) {
      sockets.push({ port, pid: Number.parseInt(m[1]!, 10) });
    }
  }
  return sockets;
}

/**
 * `lsof -Fpn` output → listening sockets. `-F` emits one field per line: `p<pid>` opens a
 * process paragraph, each `n<addr>` names a socket (`*:5173`, `127.0.0.1:8080`,
 * `[::1]:9090`) attributed to the current paragraph's pid.
 */
export function parseLsofListenPorts(output: string): ListenSocket[] {
  const sockets: ListenSocket[] = [];
  let pid = 0;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      const n = Number.parseInt(line.slice(1), 10);
      pid = Number.isInteger(n) && n > 0 ? n : 0;
      continue;
    }
    if (!line.startsWith("n") || pid === 0) continue;
    const m = /:(\d{1,5})$/.exec(line.trim());
    if (!m) continue;
    const port = Number.parseInt(m[1]!, 10);
    if (Number.isInteger(port) && port > 0) sockets.push({ port, pid });
  }
  return sockets;
}

/** Shapes of the one-shot PowerShell probe's JSON payload (ConvertTo-Json collapses single-element arrays to the bare object). */
interface WindowsProbePayload {
  c?:
    | { LocalPort?: number; OwningProcess?: number }
    | { LocalPort?: number; OwningProcess?: number }[];
  p?:
    | { ProcessId?: number; ParentProcessId?: number }
    | { ProcessId?: number; ParentProcessId?: number }[];
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * The PowerShell probe's JSON → ports listened on by `rootPid`'s process tree. The tree
 * is walked from the root over ParentProcessId edges (pid reuse makes this an
 * approximation, same as every tree-kill on Windows).
 */
export function parseWindowsProbe(json: string, rootPid: number): number[] | null {
  let payload: WindowsProbePayload;
  try {
    payload = JSON.parse(json) as WindowsProbePayload;
  } catch {
    return null;
  }
  const children = new Map<number, number[]>();
  for (const proc of asArray(payload.p)) {
    if (typeof proc.ProcessId !== "number" || typeof proc.ParentProcessId !== "number") continue;
    const list = children.get(proc.ParentProcessId) ?? [];
    list.push(proc.ProcessId);
    children.set(proc.ParentProcessId, list);
  }
  const tree = new Set<number>([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (!tree.has(child)) {
        tree.add(child);
        queue.push(child);
      }
    }
  }
  const ports: number[] = [];
  for (const conn of asArray(payload.c)) {
    if (typeof conn.LocalPort !== "number" || typeof conn.OwningProcess !== "number") continue;
    if (tree.has(conn.OwningProcess)) ports.push(conn.LocalPort);
  }
  return ports;
}

/** Runs one probe child with the hard timeout; null on any failure (missing tool, non-zero exit, timeout). */
function run(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, encoding: "utf8" },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });
}

/**
 * Ports the session's process group / tree is listening on. `null` = the probe failed
 * ("don't know" — keep any previously known result); `[]` = it succeeded and found no
 * listeners (a stale URL should clear). Deduplicated, ascending.
 */
export async function probeGroupListenPorts(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<number[] | null> {
  let sockets: ListenSocket[] | null = null;
  let owned: Set<number> | null = null;
  if (platform === "linux") {
    const [ps, ss] = await Promise.all([
      run("ps", ["-o", "pid=", "-g", String(pid)]),
      run("ss", ["-ltnp"]),
    ]);
    if (ps === null || ss === null) return null;
    owned = new Set(parsePsPids(ps));
    sockets = parseSsListenPorts(ss);
  } else if (platform === "darwin") {
    const out = await run("lsof", [
      "-a",
      "-g",
      String(pid),
      "-iTCP",
      "-sTCP:LISTEN",
      "-n",
      "-P",
      "-Fpn",
    ]);
    // lsof exits 1 when nothing matches; that is indistinguishable from failure here, so a
    // null darwin probe conservatively reads as "don't know" rather than "no listeners".
    if (out === null) return null;
    sockets = parseLsofListenPorts(out);
  } else if (platform === "win32") {
    const script =
      "@{c=@(Get-NetTCPConnection -State Listen|Select-Object LocalPort,OwningProcess);" +
      "p=@(Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId)}" +
      "|ConvertTo-Json -Depth 3 -Compress";
    const out = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
    if (out === null) return null;
    const ports = parseWindowsProbe(out, pid);
    return ports === null ? null : [...new Set(ports)].sort((a, b) => a - b);
  } else {
    return null;
  }
  const ports = new Set<number>();
  for (const socket of sockets) {
    if (owned === null || owned.has(socket.pid)) ports.add(socket.port);
  }
  return [...ports].sort((a, b) => a - b);
}
