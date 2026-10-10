#!/usr/bin/env node
/**
 * Prints a snapshot of the machine it runs on as an a2ui `metrics` block to paste into a reply:
 * the CPU's busy share with a short history, memory and disk used, the 1-minute load average and
 * the uptime. `node sysinfo.mjs [--samples N] [--interval ms] [--disk <path>] [--lang zh|en]
 * [--json]`. Exit codes: 0 printed, 1 the snapshot failed, 2 usage.
 *
 * Every reading comes from Node's own `os` and `fs` modules, with no shell and no dependencies, so
 * the script runs the same on Windows, macOS and Linux. A reading the platform cannot give (the
 * load average on Windows, a disk statfs refuses) is left out rather than guessed. The builders
 * are exported and the CLI runs only when this file is the entry point, so a test can take a real
 * snapshot and validate the block with the catalog's own parser.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const USAGE = `usage: node sysinfo.mjs [--samples N] [--interval ms] [--disk <path>] [--lang zh|en] [--json]

Takes a snapshot of this machine (CPU, memory, disk, load, uptime) and prints an a2ui metrics
block to paste into the reply. It reads the machine the agent runs on, which may not be the
user's own computer.
  --samples   CPU readings for the history, 2-20 (default 6)
  --interval  milliseconds between readings, 100-1000 (default 250)
  --disk      a path on the disk to report (default: the root of the working directory)
  --lang      zh or en for the labels (default en)
  --json      print the bare JSON object instead of the fence
exit code: 0 printed · 1 the snapshot failed · 2 usage`;

const CHECK_HINT = "Run check.mjs on the whole reply before sending.";
const GIB = 1024 ** 3;
/** The catalog's limits on a metrics title and a tile's detail line, in code points. */
const TITLE_MAX = 40;
const DETAIL_MAX = 60;
const LABELS = {
  en: { cpu: "CPU", memory: "Memory", disk: "Disk", load: "Load", uptime: "Uptime", days: "days" },
  zh: { cpu: "CPU", memory: "内存", disk: "磁盘", load: "负载", uptime: "运行时间", days: "天" },
};

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

/** Memory in bytes. On Linux the cache the kernel can reclaim counts as free, as `free` does. */
function memory() {
  if (process.platform === "linux") {
    try {
      const text = fs.readFileSync("/proc/meminfo", "utf8");
      const kib = (name) => Number(new RegExp(`^${name}:\\s+(\\d+)`, "m").exec(text)?.[1]) * 1024;
      const total = kib("MemTotal");
      const available = kib("MemAvailable");
      if (total > 0 && available >= 0) return { memTotal: total, memUsed: total - available };
    } catch {
      // Unreadable here (a sandbox): fall back to what os reports.
    }
  }
  const total = os.totalmem();
  return { memTotal: total, memUsed: total - os.freemem() };
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
 * Reads the machine: `samples` CPU readings `interval` ms apart (the last is the current busy
 * share, all of them the history), then memory, the disk holding `disk` (default: the root of
 * the working directory), the 1-minute load average (left out where the platform reports 0, as
 * Windows does) and the uptime. Sizes are in bytes; `asOf` is the time the readings ended.
 */
export async function collectSysinfo({ samples = 6, interval = 250, disk } = {}) {
  const cpuHistory = [];
  let before = cpuTimes();
  for (let i = 0; i < samples; i++) {
    await sleep(interval);
    const after = cpuTimes();
    const busy = busyPercent(before, after);
    if (busy !== undefined) cpuHistory.push(busy);
    before = after;
  }
  const info = {
    host: os.hostname(),
    cpus: os.cpus().length || os.availableParallelism(),
    cpuHistory,
    ...memory(),
    uptimeSec: Math.round(os.uptime()),
    asOf: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
  const target = disk === undefined ? path.parse(process.cwd()).root : path.resolve(disk);
  const usage = await diskUsage(target);
  if (usage !== undefined) info.disk = usage;
  const load1 = os.loadavg()[0];
  if (load1 > 0) info.load1 = load1;
  return info;
}

/** A `used` tile in GB (binary) with marks at 85 % and 95 %; undefined if the size rounds to 0. */
function usedTile(label, used, total) {
  const max = round(total / GIB, 1);
  if (!(max > 0) || !(used >= 0)) return undefined;
  return {
    label,
    kind: "used",
    value: round(used / GIB, 1),
    max,
    unit: "GB",
    decimals: 1,
    warn: round(max * 0.85, 1),
    danger: round(max * 0.95, 1),
  };
}

/**
 * The a2ui metrics block for a `collectSysinfo` snapshot: CPU as a ring with its history, memory
 * and disk used (the disk's detail line names its path), the load average as a bar against the
 * core count, and the uptime in days. A reading the snapshot lacks is left out; the labels
 * follow `lang`. Throws when not one reading is left.
 */
export function buildMetricsBlock(info, { lang = "en" } = {}) {
  const labels = LABELS[lang] ?? LABELS.en;
  const items = [];
  const cpu = Array.isArray(info.cpuHistory) ? info.cpuHistory : [];
  if (cpu.length > 0) {
    const tile = {
      label: labels.cpu,
      kind: "reading",
      value: cpu[cpu.length - 1],
      max: 100,
      unit: "%",
      gauge: "ring",
      warn: 80,
      danger: 95,
    };
    if (cpu.length >= 2) tile.history = cpu.slice(-60);
    items.push(tile);
  }
  const memoryTile = usedTile(labels.memory, info.memUsed, info.memTotal);
  if (memoryTile !== undefined) items.push(memoryTile);
  const diskTile = info.disk ? usedTile(labels.disk, info.disk.used, info.disk.total) : undefined;
  if (diskTile !== undefined) {
    if (info.disk.path) diskTile.detail = clip(String(info.disk.path), DETAIL_MAX);
    items.push(diskTile);
  }
  if (info.load1 > 0 && info.cpus > 0) {
    items.push({
      label: labels.load,
      kind: "reading",
      value: round(info.load1, 2),
      decimals: 2,
      max: info.cpus,
      gauge: "bar",
      warn: info.cpus,
      danger: info.cpus * 2,
    });
  }
  if (info.uptimeSec >= 0) {
    items.push({
      label: labels.uptime,
      kind: "reading",
      value: round(info.uptimeSec / 86_400, 1),
      decimals: 1,
      unit: labels.days,
    });
  }
  if (items.length === 0) throw new Error("Not one reading could be taken on this machine.");
  const block = { type: "metrics" };
  if (info.host) block.title = clip(String(info.host), TITLE_MAX);
  block.items = items;
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
      disk: { type: "string" },
      lang: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return { help: true };
  const lang = values.lang ?? "en";
  if (lang !== "zh" && lang !== "en") throw new Error(`--lang must be zh or en (got "${lang}")`);
  return {
    samples: intOption("--samples", values.samples, 6, 2, 20),
    interval: intOption("--interval", values.interval, 250, 100, 1000),
    disk: values.disk,
    lang,
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
    if (args.disk !== undefined && info.disk === undefined) {
      console.error(`Could not read the disk at ${args.disk}; the block leaves it out.`);
    }
    const block = buildMetricsBlock(info, { lang: args.lang });
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
