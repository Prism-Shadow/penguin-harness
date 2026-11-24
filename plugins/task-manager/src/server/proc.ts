/**
 * A process's CPU and memory, read from `/proc` on Linux: the one platform whose kernel publishes
 * both for a pid without a helper program. Everywhere else answers null — the tree still lists the
 * processes, it just has no figures for them — so nothing here guesses a number.
 *
 * Two readings of `/proc/<pid>/stat` a moment apart give the CPU share: the fields are
 * `utime + stime` in clock ticks since the process started, and the difference over the interval,
 * divided by the ticks that passed in it, is that process's share of ONE core. `/proc` keeps the
 * fields positional, but the command name in field 2 is parenthesised and may itself hold spaces
 * or parentheses, so the fields after it are counted from the LAST `)`.
 *
 * The parsers are pure — they take text, not the machine — so the suite pins them with fixtures
 * rather than the host it happens to run on.
 */
import fs from "node:fs/promises";

/** Linux's own unit for `/proc/<pid>/stat`'s CPU fields (`sysconf(_SC_CLK_TCK)`): 100 on every kernel that publishes the file. */
export const CLOCK_TICKS_PER_SECOND = 100;

/** One process's CPU and memory as `/proc` publishes them at one instant. */
export interface ProcSample {
  /** The process's own user and system time, in clock ticks. */
  cpuTicks: number;
  /** Its resident set, in bytes. */
  memoryBytes: number;
}

/** `utime` and `stime` are fields 14 and 15; field 3 is `state`, so they are the 12th and 13th after the name. */
const UTIME_INDEX = 14 - 3;
const STIME_INDEX = 15 - 3;

/**
 * A `/proc/<pid>/stat` line as its CPU ticks: null when the text is not one — a process that
 * exited between listing and reading, or a kernel that shaped the file differently.
 */
export function parseStatCpuTicks(stat: string): number | null {
  // The command name is field 2, between the first "(" and the LAST ")": it may hold both.
  const open = stat.indexOf("(");
  const close = stat.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  if (fields.length <= STIME_INDEX) return null;
  const utime = Number(fields[UTIME_INDEX]);
  const stime = Number(fields[STIME_INDEX]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
  return utime + stime;
}

/** A `/proc/<pid>/status` text as its resident memory in bytes: null when it names none. */
export function parseStatusMemoryBytes(status: string): number | null {
  // "VmRSS:\t   1234 kB" — the kernel's own unit for every Vm* line.
  const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
  if (match === null) return null;
  const kb = Number(match[1]);
  return Number.isFinite(kb) ? kb * 1024 : null;
}

/**
 * The CPU share of one core between two samples of the same process, in percent with one decimal;
 * capped at 100, since the tree asks what one task costs and not what a thread pool does. Null when
 * the interval carries no time to divide by, or the tick count went backwards (the pid was reused).
 */
export function cpuPercentBetween(
  before: ProcSample,
  after: ProcSample,
  intervalMs: number,
): number | null {
  if (intervalMs <= 0) return null;
  const elapsedTicks = (intervalMs * CLOCK_TICKS_PER_SECOND) / 1000;
  if (elapsedTicks <= 0) return null;
  const usedTicks = after.cpuTicks - before.cpuTicks;
  if (usedTicks < 0) return null;
  return Math.min(100, Math.round((usedTicks / elapsedTicks) * 1000) / 10);
}

/** Whether this process can read `/proc` at all: the figures exist on Linux and nowhere else. */
export function procAvailable(): boolean {
  return process.platform === "linux";
}

/** Reads a file of `/proc` as text; injected so the suite never reads the host's own. */
export type ProcReader = (file: string) => Promise<string>;

/** The reader a route uses: the real `/proc`. */
export const readProcFile: ProcReader = (file) => fs.readFile(file, "utf8");

const MAX_TREE_PIDS = 64;

/** Reads a single process's own `/proc/<pid>/stat` and `/proc/<pid>/status`. */
async function sampleSinglePid(pid: number, readFile: ProcReader): Promise<ProcSample | null> {
  const stat = await readFile(`/proc/${pid}/stat`).catch(() => null);
  if (stat === null) return null;
  const cpuTicks = parseStatCpuTicks(stat);
  if (cpuTicks === null) return null;
  const status = await readFile(`/proc/${pid}/status`).catch(() => null);
  return { cpuTicks, memoryBytes: status === null ? 0 : (parseStatusMemoryBytes(status) ?? 0) };
}

/**
 * One sample of a pid (including any live descendants listed in `/proc/<pid>/task/<pid>/children`
 * so a shell wrapper's child commands are counted with it); null when the root pid is gone,
 * unreadable, or there is no `/proc` to read.
 */
export async function sampleProc(pid: number, readFile: ProcReader): Promise<ProcSample | null> {
  if (!procAvailable() || !Number.isInteger(pid) || pid <= 0) return null;
  const root = await sampleSinglePid(pid, readFile);
  if (root === null) return null;
  let totalCpuTicks = root.cpuTicks;
  let totalMemoryBytes = root.memoryBytes;
  const visited = new Set<number>([pid]);
  const queue: number[] = [pid];
  while (queue.length > 0 && visited.size < MAX_TREE_PIDS) {
    const current = queue.shift()!;
    const childrenRaw = await readFile(`/proc/${current}/task/${current}/children`).catch(
      () => null,
    );
    if (childrenRaw === null) continue;
    for (const token of childrenRaw.trim().split(/\s+/)) {
      if (token.length === 0) continue;
      const childPid = Number.parseInt(token, 10);
      if (!Number.isInteger(childPid) || childPid <= 0 || visited.has(childPid)) continue;
      visited.add(childPid);
      const childSample = await sampleSinglePid(childPid, readFile);
      if (childSample !== null) {
        totalCpuTicks += childSample.cpuTicks;
        totalMemoryBytes += childSample.memoryBytes;
        queue.push(childPid);
      }
      if (visited.size >= MAX_TREE_PIDS) break;
    }
  }
  return { cpuTicks: totalCpuTicks, memoryBytes: totalMemoryBytes };
}

/** The interval between the two samples a CPU figure needs, when the caller names none. */
export const DEFAULT_SAMPLE_INTERVAL_MS = 200;

/** What one process costs right now. */
export interface ProcessUsage {
  /** Share of one CPU core in percent; null when the process could not be sampled twice. */
  cpu: number | null;
  /** Resident memory in bytes; null when the process could not be read. */
  memory: number | null;
}

/** A wait that never rejects: the interval between the two samples. */
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What every named pid costs right now: one sample, a short wait, a second sample. A pid that is
 * gone in either reading has no figures at all — it exited while the tree was being built, which is
 * not an error. Without `/proc` every pid answers nulls in one pass, no waiting.
 */
export async function measureProcesses(
  pids: readonly number[],
  opts: { intervalMs?: number; readFile?: ProcReader } = {},
): Promise<Map<number, ProcessUsage>> {
  const readFile = opts.readFile ?? readProcFile;
  const out = new Map<number, ProcessUsage>();
  const none = (): ProcessUsage => ({ cpu: null, memory: null });
  if (pids.length === 0) return out;
  const before = new Map<number, ProcSample>();
  if (procAvailable()) {
    for (const pid of pids) {
      const sample = await sampleProc(pid, readFile);
      if (sample !== null) before.set(pid, sample);
    }
  }
  if (before.size === 0) {
    for (const pid of pids) out.set(pid, none());
    return out;
  }
  await wait(opts.intervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS);
  for (const pid of pids) {
    const first = before.get(pid);
    if (first === undefined) {
      out.set(pid, none());
      continue;
    }
    const second = await sampleProc(pid, readFile);
    if (second === null) {
      out.set(pid, none());
      continue;
    }
    out.set(pid, {
      cpu: cpuPercentBetween(first, second, opts.intervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS),
      memory: second.memoryBytes,
    });
  }
  return out;
}
