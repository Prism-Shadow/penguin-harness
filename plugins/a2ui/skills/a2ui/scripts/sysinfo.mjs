#!/usr/bin/env node
/**
 * Prints a snapshot of the machine it runs on as an a2ui `resources` block to paste into a reply:
 * the CPU's busy share with a short history, memory with its history, swap, the disks, the
 * network's receive and send rates, the load averages and the uptime. `node sysinfo.mjs
 * [--samples N] [--interval ms] [--disk <path>]... [--json]`. Exit codes: 0 printed, 1 the
 * snapshot failed, 2 usage.
 *
 * Every reading comes from Node's own `os` and `fs` modules, with no shell and no dependencies, so
 * the script runs the same on Windows, macOS and Linux. A reading the platform cannot give (swap
 * and the network outside Linux, the load average on Windows, a disk statfs refuses) is left out
 * rather than guessed. The block carries numbers only: the app names the readings in the reader's
 * language and colours them by its own thresholds. The builders are exported and the CLI runs only
 * when this file is the entry point, so a test can take a real snapshot and validate the block
 * with the catalog's own parser.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const USAGE = `usage: node sysinfo.mjs [--samples N] [--interval ms] [--disk <path>]... [--json]

Takes a snapshot of this machine (CPU, memory, swap, disks, network, load, uptime) and prints an
a2ui resources block to paste into the reply. It reads the machine the agent runs on, which may
not be the user's own computer.
  --samples   readings for the CPU, memory and network history, 2-20 (default 6)
  --interval  milliseconds between readings, 100-1000 (default 250)
  --disk      a path on a disk to report; repeat it for up to 6 disks
              (default: the root of the working directory)
  --json      print the bare JSON object instead of the fence
exit code: 0 printed · 1 the snapshot failed · 2 usage`;

const CHECK_HINT = "Run check.mjs on the whole reply before sending.";
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const TIB = 1024 ** 4;
/** The catalog's limits on a resources block, in code points and entries. */
const HOST_MAX = 40;
const PATH_MAX = 40;
const DISKS_MAX = 6;
const HISTORY_MAX = 60;
/** Each list is ascending: a size takes the largest unit it reaches. */
const MEMORY_UNITS = [
  ["MB", MIB],
  ["GB", GIB],
];
const DISK_UNITS = [
  ["GB", GIB],
  ["TB", TIB],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Cuts a string to `max` code points, the unit the catalog's limits count. */
function clip(text, max) {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : text;
}

/** CPU time summed over every core: the idle part and the total, in the platform's units. */
function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const { times } of os.cpus()) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

/** The busy share in whole percent between two cpuTimes() readings; undefined if no time passed. */
function busyPercent(before, after) {
  const total = after.total - before.total;
  if (!(total > 0)) return undefined;
  const busy = 1 - (after.idle - before.idle) / total;
  return Math.round(Math.min(1, Math.max(0, busy)) * 100);
}

/**
 * Memory in bytes, and swap where the platform tells it. On Linux the cache the kernel can
 * reclaim counts as free, as `free` does.
 */
function memory() {
  if (process.platform === "linux") {
    try {
      const text = fs.readFileSync("/proc/meminfo", "utf8");
      const kib = (name) => Number(new RegExp(`^${name}:\\s+(\\d+)`, "m").exec(text)?.[1]) * 1024;
      const total = kib("MemTotal");
      const available = kib("MemAvailable");
      if (total > 0 && available >= 0) {
        const reading = { memTotal: total, memUsed: total - available };
        const swapTotal = kib("SwapTotal");
        const swapFree = kib("SwapFree");
        if (swapTotal > 0 && swapFree >= 0) {
          reading.swapTotal = swapTotal;
          reading.swapUsed = swapTotal - swapFree;
        }
        return reading;
      }
    } catch {
      // Unreadable here (a sandbox): fall back to what os reports.
    }
  }
  const total = os.totalmem();
  return { memTotal: total, memUsed: total - os.freemem() };
}

/**
 * Bytes received and sent so far over every interface but loopback, from Linux's
 * /proc/net/dev; undefined elsewhere, where Node offers no counters without a shell.
 */
function netBytes() {
  if (process.platform !== "linux") return undefined;
  try {
    let rx = 0;
    let tx = 0;
    for (const line of fs.readFileSync("/proc/net/dev", "utf8").split("\n").slice(2)) {
      const colon = line.indexOf(":");
      if (colon < 0 || line.slice(0, colon).trim() === "lo") continue;
      const fields = line
        .slice(colon + 1)
        .trim()
        .split(/\s+/)
        .map(Number);
      rx += fields[0] || 0;
      tx += fields[8] || 0;
    }
    return { rx, tx };
  } catch {
    return undefined;
  }
}

/** Size and used bytes of the file system holding `target`, as `df` counts them, or undefined. */
async function diskUsage(target) {
  try {
    const stats = await fs.promises.statfs(target);
    const total = stats.blocks * stats.bsize;
    const used = (stats.blocks - stats.bfree) * stats.bsize;
    return total > 0 ? { path: target, total, used } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the machine: `samples` readings `interval` ms apart — the CPU's busy share, memory in
 * use as a percent and, on Linux, the bytes per second received and sent (the last of each is
 * the current one, all of them the history) — then memory and swap, the disks holding `disks`
 * (default: the root of the working directory), the load averages (not on Windows, which
 * reports none) and the uptime. Sizes are in bytes; `asOf` is the time the readings ended.
 */
export async function collectSysinfo({ samples = 6, interval = 250, disks } = {}) {
  const cpuHistory = [];
  const memHistory = [];
  const rx = [];
  const tx = [];
  let before = cpuTimes();
  let netBefore = netBytes();
  let readAt = Date.now();
  for (let i = 0; i < samples; i++) {
    await sleep(interval);
    const after = cpuTimes();
    const busy = busyPercent(before, after);
    if (busy !== undefined) cpuHistory.push(busy);
    before = after;
    const mem = memory();
    if (mem.memTotal > 0) memHistory.push(round((mem.memUsed / mem.memTotal) * 100, 1));
    const netAfter = netBytes();
    const now = Date.now();
    if (netBefore !== undefined && netAfter !== undefined && now > readAt) {
      const seconds = (now - readAt) / 1000;
      // A counter that went back (an interface reset) reads as no traffic, not a negative rate.
      rx.push(Math.max(0, netAfter.rx - netBefore.rx) / seconds);
      tx.push(Math.max(0, netAfter.tx - netBefore.tx) / seconds);
    }
    netBefore = netAfter;
    readAt = now;
  }
  const info = {
    host: os.hostname(),
    cpus: os.cpus().length || os.availableParallelism(),
    cpuHistory,
    ...memory(),
    memHistory,
    disks: [],
    uptimeSec: Math.round(os.uptime()),
    asOf: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
  const targets =
    disks === undefined || disks.length === 0
      ? [path.parse(process.cwd()).root]
      : disks.map((disk) => path.resolve(disk));
  for (const target of targets) {
    const usage = await diskUsage(target);
    if (usage !== undefined) info.disks.push(usage);
  }
  if (rx.length >= 2) info.network = { rx, tx };
  if (process.platform !== "win32") info.load = os.loadavg();
  return info;
}

/**
 * Used of total, both from bytes into the largest unit of `units` the total reaches, to one
 * decimal; undefined when the total rounds to nothing.
 */
function usage(usedBytes, totalBytes, units) {
  if (!(totalBytes > 0) || !(usedBytes >= 0)) return undefined;
  const [unit, size] = units.findLast(([, bytes]) => totalBytes >= bytes) ?? units[0];
  const total = round(totalBytes / size, 1);
  if (!(total > 0)) return undefined;
  return { used: Math.min(round(usedBytes / size, 1), total), total, unit };
}

/** The rates in KB/s, or in MB/s once one of them reaches a megabyte per second. */
function rates({ rx, tx }) {
  const peak = Math.max(...rx, ...tx);
  const [unit, size] = peak >= MIB ? ["MB/s", MIB] : ["KB/s", 1024];
  const scale = (values) => values.slice(-HISTORY_MAX).map((v) => round(Math.max(0, v) / size, 1));
  return { unit, rx: scale(rx), tx: scale(tx) };
}

/**
 * The a2ui resources block for a `collectSysinfo` snapshot: the CPU with its history and core
 * count, memory with its history, swap, each disk (a path once), the network rates, the load
 * averages against the core count and the uptime. A reading the snapshot lacks is left out.
 * Throws when not one reading is left.
 */
export function buildResourcesBlock(info) {
  const block = { type: "resources" };
  if (info.host) block.host = clip(String(info.host), HOST_MAX);
  const cpu = Array.isArray(info.cpuHistory) ? info.cpuHistory : [];
  if (cpu.length > 0) {
    block.cpu = { percent: cpu[cpu.length - 1] };
    if (cpu.length >= 2) block.cpu.history = cpu.slice(-HISTORY_MAX);
    if (info.cpus >= 1) block.cpu.cores = info.cpus;
  }
  const mem = usage(info.memUsed, info.memTotal, MEMORY_UNITS);
  if (mem !== undefined) {
    block.memory = mem;
    const history = Array.isArray(info.memHistory) ? info.memHistory : [];
    if (history.length >= 2) block.memory.history = history.slice(-HISTORY_MAX);
  }
  const swap = usage(info.swapUsed, info.swapTotal, MEMORY_UNITS);
  if (swap !== undefined) block.swap = swap;
  const seen = new Set();
  const disks = [];
  for (const disk of Array.isArray(info.disks) ? info.disks : []) {
    const size = usage(disk.used, disk.total, DISK_UNITS);
    const where = clip(String(disk.path), PATH_MAX);
    if (size === undefined || seen.has(where) || disks.length === DISKS_MAX) continue;
    seen.add(where);
    disks.push({ path: where, ...size });
  }
  if (disks.length > 0) block.disks = disks;
  if (
    info.network &&
    info.network.rx?.length >= 2 &&
    info.network.rx.length === info.network.tx?.length
  ) {
    block.network = rates(info.network);
  }
  if (Array.isArray(info.load) && info.load.length >= 3 && info.cpus >= 1) {
    const [one, five, fifteen] = info.load.map((v) => round(v, 2));
    block.load = { one, five, fifteen, cores: info.cpus };
  }
  if (info.uptimeSec >= 0) block.uptimeSec = info.uptimeSec;
  if (Object.keys(block).every((key) => key === "type" || key === "host")) {
    throw new Error("Not one reading could be taken on this machine.");
  }
  if (info.asOf) block.asOf = info.asOf;
  return block;
}

const messageOf = (err) => (err instanceof Error ? err.message : String(err));
const isObject = (value) => value !== null && typeof value === "object";

/** One value on one line, with a space after each comma and inside the braces. */
function inline(value) {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  const fields = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`);
  return `{ ${fields.join(", ")} }`;
}

/** The block as the skill writes one: a key per line, each entry of a list on a line of its own. */
function formatBlock(block) {
  const lines = Object.entries(block)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const head = `  ${JSON.stringify(key)}: `;
      if (!Array.isArray(value) || !value.some(isObject)) return head + inline(value);
      return `${head}[\n${value.map((item) => `    ${inline(item)}`).join(",\n")}\n  ]`;
    });
  return `{\n${lines.join(",\n")}\n}`;
}

/** The fence to paste: the block's JSON inside an a2ui fence. */
const toFence = (block) => "```a2ui\n" + formatBlock(block) + "\n```";

function intOption(name, text, fallback, min, max) {
  if (text === undefined) return fallback;
  const n = Number(text);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max} (got "${text}")`);
  }
  return n;
}

/** The options of a command line; throws with a message on a usage error. */
function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      samples: { type: "string" },
      interval: { type: "string" },
      disk: { type: "string", multiple: true },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return { help: true };
  const disks = [...new Set(values.disk ?? [])];
  if (disks.length > DISKS_MAX) {
    throw new Error(`--disk can name at most ${DISKS_MAX} disks (got ${disks.length})`);
  }
  return {
    samples: intOption("--samples", values.samples, 6, 2, 20),
    interval: intOption("--interval", values.interval, 250, 100, 1000),
    disks,
    json: values.json === true,
  };
}

async function main(argv) {
  let args;
  try {
    args = parseCli(argv);
  } catch (err) {
    console.error(`${messageOf(err)}\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  try {
    const info = await collectSysinfo(args);
    const read = new Set(info.disks.map((disk) => disk.path));
    for (const disk of args.disks) {
      if (!read.has(path.resolve(disk))) {
        console.error(`Could not read the disk at ${disk}; the block leaves it out.`);
      }
    }
    const block = buildResourcesBlock(info);
    console.log(args.json ? JSON.stringify(block, null, 2) : toFence(block));
    console.error(CHECK_HINT);
    return 0;
  } catch (err) {
    console.error(messageOf(err));
    return 1;
  }
}

const entry = process.argv[1] !== undefined ? path.resolve(process.argv[1]) : "";
if (entry !== "" && entry === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
