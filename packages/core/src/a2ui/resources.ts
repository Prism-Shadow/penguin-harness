/**
 * The system-resource board: a `resources` block — one machine's CPU, memory, swap, disks,
 * network, load and uptime — as the grammar reads it (parseResources), as the renderer and the
 * text judge it (resolveResources, with thresholds fixed here rather than chosen by the model),
 * and as text (resourcesMarkdown). It is a composition of the basic charts: each reading becomes
 * a metrics item (resourcesTiles), so it draws as the metrics block's tile and prints as its
 * line; the disks are horizontal bars on a shared percent scale; the network is a line chart.
 */
import {
  type Issues,
  type Obj,
  isObj,
  join,
  present,
  readArray,
  readEnum,
  readInstant,
  readNumber,
  readNumbers,
  readPercent,
  readString,
  unknownFields,
} from "./fields.js";
import { metricLine } from "./metric.js";
import {
  A2UI_LIMITS,
  type A2uiLang,
  type A2uiMetric,
  type A2uiResources,
  type A2uiResourcesCpu,
  type A2uiResourcesDisk,
  type A2uiResourcesLoad,
  type A2uiResourcesMemory,
  type A2uiResourcesNetwork,
  type A2uiResourcesSwap,
} from "./types.js";
import { formatNumber, formatValue, metricDetail, resolveMetric } from "./widgets.js";

const RESOURCES_FIELDS = [
  "type",
  "host",
  "cpu",
  "memory",
  "swap",
  "disks",
  "network",
  "load",
  "uptimeSec",
  "asOf",
] as const;
const SECTIONS = ["cpu", "memory", "swap", "disks", "network", "load", "uptimeSec"] as const;
const CPU_FIELDS = ["percent", "history", "cores"] as const;
const MEMORY_FIELDS = ["used", "total", "unit", "history"] as const;
const SWAP_FIELDS = ["used", "total", "unit"] as const;
const DISK_FIELDS = ["path", "used", "total", "unit"] as const;
const NETWORK_FIELDS = ["unit", "rx", "tx"] as const;
const LOAD_FIELDS = ["one", "five", "fifteen", "cores"] as const;
const MEMORY_UNITS = ["GB", "MB"] as const;
const DISK_UNITS = ["GB", "TB"] as const;
const RATE_UNITS = ["KB/s", "MB/s", "Mbps"] as const;

/**
 * The marks the board colours by, the renderer's judgement and not the model's: CPU, memory and
 * swap in percent of the whole, a disk in percent full, the load per core.
 */
const MARKS = {
  share: { warn: 80, danger: 95 },
  disk: { warn: 85, danger: 95 },
  loadPerCore: { warn: 1, danger: 2 },
} as const;

/** A section given as something other than an object: reported, and the section is skipped. */
function section(is: Issues, obj: Obj, key: string, example: string): Obj | undefined {
  const value = obj[key];
  if (!present(value)) return undefined;
  if (isObj(value)) return value;
  is.error("wrong_type", `\`${key}\` must be an object, such as ${example}.`, key);
  return undefined;
}

/** A count of cores: a whole number of at least 1. */
function readCores(is: Issues, obj: Obj, path: string, required: boolean): number | undefined {
  const cores = readNumber(is, obj, "cores", path, required);
  if (cores === undefined || (Number.isInteger(cores) && cores >= 1)) return cores;
  const p = join(path, "cores");
  is.error(
    "range_invalid",
    `\`${p}\` is ${cores}; a core count is a whole number of at least 1.`,
    p,
  );
  return undefined;
}

/** A reading that cannot be negative. */
function readAmount(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  required: boolean,
): number | undefined {
  const value = readNumber(is, obj, key, path, required);
  if (value === undefined || value >= 0) return value;
  const p = join(path, key);
  is.error("range_invalid", `\`${p}\` is ${value}; it is at least 0. Fix the value.`, p);
  return undefined;
}

/** `used` of `total`: used at least 0, total above 0, used no more than total. */
function readUsage(
  is: Issues,
  obj: Obj,
  path: string,
): { used: number; total: number } | undefined {
  const used = readAmount(is, obj, "used", path, true);
  const total = readNumber(is, obj, "total", path, true);
  if (total !== undefined && total <= 0) {
    const p = join(path, "total");
    is.error(
      "range_invalid",
      `\`${p}\` is ${total}; the whole is above 0. Leave the section out when there is none.`,
      p,
    );
    return undefined;
  }
  if (used === undefined || total === undefined) return undefined;
  if (used > total) {
    const p = join(path, "used");
    is.error(
      "range_invalid",
      `\`${p}\` ${used} is above \`${join(path, "total")}\` ${total}; fix the values.`,
      p,
    );
  }
  return { used, total };
}

function readPercentHistory(is: Issues, obj: Obj, path: string): number[] | undefined {
  if (!present(obj.history)) return undefined;
  return readNumbers(is, obj, "history", path, {
    ...A2UI_LIMITS.history,
    what: "points",
    atLeast: 0,
    atMost: 100,
    rangeHint: "a percentage is 0–100",
  });
}

function parseCpu(is: Issues, obj: Obj): A2uiResourcesCpu | undefined {
  const cpu = section(is, obj, "cpu", '{"percent": 37}');
  if (cpu === undefined) return undefined;
  const percent = readPercent(is, cpu, "percent", "cpu");
  if (!present(cpu.percent))
    is.error("missing_field", "`cpu.percent` is required: a number 0–100.", "cpu.percent");
  const history = readPercentHistory(is, cpu, "cpu");
  const cores = readCores(is, cpu, "cpu", false);
  unknownFields(is, cpu, CPU_FIELDS, "cpu", "the cpu section");
  if (percent === undefined) return undefined;
  const out: A2uiResourcesCpu = { percent };
  if (history !== undefined) out.history = history;
  if (cores !== undefined) out.cores = cores;
  return out;
}

function parseMemory(is: Issues, obj: Obj): A2uiResourcesMemory | undefined {
  const memory = section(is, obj, "memory", '{"used": 13.9, "total": 16}');
  if (memory === undefined) return undefined;
  const usage = readUsage(is, memory, "memory");
  const unit = readEnum(is, memory, "unit", "memory", MEMORY_UNITS, false);
  const history = readPercentHistory(is, memory, "memory");
  unknownFields(is, memory, MEMORY_FIELDS, "memory", "the memory section");
  if (usage === undefined) return undefined;
  const out: A2uiResourcesMemory = { ...usage };
  if (unit !== undefined) out.unit = unit;
  if (history !== undefined) out.history = history;
  return out;
}

function parseSwap(is: Issues, obj: Obj): A2uiResourcesSwap | undefined {
  const swap = section(is, obj, "swap", '{"used": 0.5, "total": 2}');
  if (swap === undefined) return undefined;
  const usage = readUsage(is, swap, "swap");
  const unit = readEnum(is, swap, "unit", "swap", MEMORY_UNITS, false);
  unknownFields(is, swap, SWAP_FIELDS, "swap", "the swap section");
  if (usage === undefined) return undefined;
  const out: A2uiResourcesSwap = { ...usage };
  if (unit !== undefined) out.unit = unit;
  return out;
}

function parseDisks(is: Issues, obj: Obj): A2uiResourcesDisk[] | undefined {
  if (!present(obj.disks)) return undefined;
  const raw = readArray(is, obj, "disks", "", { ...A2UI_LIMITS.disks, what: "disks" });
  if (raw === undefined) return undefined;
  const disks: A2uiResourcesDisk[] = [];
  const paths = new Map<string, number>();
  raw.forEach((item, i) => {
    const dp = `disks[${i}]`;
    if (!isObj(item)) {
      is.error(
        "wrong_type",
        `\`${dp}\` must be an object with \`path\`, \`used\` and \`total\`.`,
        dp,
      );
      return;
    }
    const path = readString(is, item, "path", dp, { required: true, max: A2UI_LIMITS.diskPath });
    const usage = readUsage(is, item, dp);
    const unit = readEnum(is, item, "unit", dp, DISK_UNITS, false);
    unknownFields(is, item, DISK_FIELDS, dp, "a disk");
    if (path === undefined || usage === undefined) return;
    const first = paths.get(path);
    if (first !== undefined) {
      is.error(
        "duplicate_label",
        `\`${dp}.path\` repeats disk ${first + 1}'s path "${path}"; list each disk once.`,
        `${dp}.path`,
      );
    } else {
      paths.set(path, i);
    }
    const disk: A2uiResourcesDisk = { path, ...usage };
    if (unit !== undefined) disk.unit = unit;
    disks.push(disk);
  });
  return disks;
}

function parseNetwork(is: Issues, obj: Obj): A2uiResourcesNetwork | undefined {
  const network = section(is, obj, "network", '{"unit": "KB/s", "rx": [120, 98], "tx": [40, 35]}');
  if (network === undefined) return undefined;
  const unit = readEnum(is, network, "unit", "network", RATE_UNITS);
  const rule = {
    ...A2UI_LIMITS.history,
    what: "readings",
    atLeast: 0,
    rangeHint: "a rate is at least 0",
  };
  const rx = readNumbers(is, network, "rx", "network", rule);
  const tx = readNumbers(is, network, "tx", "network", rule);
  unknownFields(is, network, NETWORK_FIELDS, "network", "the network section");
  if (rx !== undefined && tx !== undefined && rx.length !== tx.length) {
    is.error(
      "length_mismatch",
      `\`network.tx\` has ${tx.length} readings and \`network.rx\` ${rx.length}; give both the same readings, oldest first.`,
      "network.tx",
    );
  }
  if (unit === undefined || rx === undefined || tx === undefined) return undefined;
  return { unit, rx, tx };
}

function parseLoad(is: Issues, obj: Obj): A2uiResourcesLoad | undefined {
  const load = section(is, obj, "load", '{"one": 1.2, "cores": 4}');
  if (load === undefined) return undefined;
  const one = readAmount(is, load, "one", "load", true);
  const five = readAmount(is, load, "five", "load", false);
  const fifteen = readAmount(is, load, "fifteen", "load", false);
  const cores = readCores(is, load, "load", true);
  unknownFields(is, load, LOAD_FIELDS, "load", "the load section");
  if (one === undefined || cores === undefined) return undefined;
  const out: A2uiResourcesLoad = { one, cores };
  if (five !== undefined) out.five = five;
  if (fifteen !== undefined) out.fifteen = fifteen;
  return out;
}

/** Reads one `resources` block. Undefined when no section is given. */
export function parseResources(is: Issues, obj: Obj): A2uiResources | undefined {
  const host = readString(is, obj, "host", "", { max: A2UI_LIMITS.host });
  const cpu = parseCpu(is, obj);
  const memory = parseMemory(is, obj);
  const swap = parseSwap(is, obj);
  const disks = parseDisks(is, obj);
  const network = parseNetwork(is, obj);
  const load = parseLoad(is, obj);
  const uptimeSec = readAmount(is, obj, "uptimeSec", "", false);
  const asOf = readInstant(is, obj, "asOf", "");
  unknownFields(is, obj, RESOURCES_FIELDS, "", "a resources block");
  if (!SECTIONS.some((key) => present(obj[key]))) {
    is.error(
      "missing_field",
      `A resources block needs at least one of ${SECTIONS.join(", ")}; add the readings you have (scripts/sysinfo.mjs prints them).`,
    );
    return undefined;
  }
  const spec: A2uiResources = { type: "resources" };
  if (host !== undefined) spec.host = host;
  if (cpu !== undefined) spec.cpu = cpu;
  if (memory !== undefined) spec.memory = memory;
  if (swap !== undefined) spec.swap = swap;
  if (disks !== undefined) spec.disks = disks;
  if (network !== undefined) spec.network = network;
  if (load !== undefined) spec.load = load;
  if (uptimeSec !== undefined) spec.uptimeSec = uptimeSec;
  if (asOf !== undefined) spec.asOf = asOf;
  return spec;
}

export type A2uiResourceKey = "cpu" | "memory" | "swap" | "load" | "uptime";
export type A2uiResourceTone = "attention" | "danger";

/** One reading of the board as a metrics item, without its label (the caller names it in its language). */
export interface A2uiResourceTile {
  key: A2uiResourceKey;
  metric: Omit<A2uiMetric, "label">;
}

export interface A2uiResolvedDisk {
  path: string;
  used: number;
  total: number;
  unit: "GB" | "TB";
  /** used / total, 0–1. */
  share: number;
  tone?: A2uiResourceTone;
}

/** The tone of every section the fixed marks colour; a calm section has none. */
export interface A2uiResolvedResources {
  cpu?: A2uiResourceTone;
  memory?: A2uiResourceTone;
  swap?: A2uiResourceTone;
  load?: A2uiResourceTone;
  /** One per disk, in the block's order. */
  disks: A2uiResolvedDisk[];
}

const TILE_WORDS = {
  en: {
    cores: (n: number) => `${n} ${n === 1 ? "core" : "cores"}`,
    days: "days",
    hours: "hours",
    minutes: "min",
  },
  zh: {
    cores: (n: number) => `${n} 核`,
    days: "天",
    hours: "小时",
    minutes: "分钟",
  },
} as const;

/** Rounded so a sparkline's points print and compare cleanly. */
const round = (value: number, digits = 3): number => Number(value.toFixed(digits));

/** A used-of-total reading with the share marks in its own unit. */
function usageMetric(
  usage: { used: number; total: number },
  unit: string,
  marks: { warn: number; danger: number },
): Omit<A2uiMetric, "label"> {
  return {
    value: usage.used,
    max: usage.total,
    kind: "used",
    unit,
    warn: round((usage.total * marks.warn) / 100),
    danger: round((usage.total * marks.danger) / 100),
  };
}

/** A disk as a used-of-total reading with the disk marks: the line the text prints, the tone the bar takes. */
const diskMetric = (disk: A2uiResourcesDisk): Omit<A2uiMetric, "label"> =>
  usageMetric(disk, disk.unit ?? "GB", MARKS.disk);

/**
 * The board's readings as metrics items, in the order the board draws them: CPU, memory, swap,
 * load, uptime (a section the block leaves out has no tile). Each carries the fixed marks as its
 * `warn`/`danger`, so resolveMetric gives the tone the board judges; the memory history comes
 * back in the memory's unit. `lang` words the few parts that are words: the cores under CPU and
 * load, the load's 5- and 15-minute averages, and uptime's unit.
 */
export function resourcesTiles(spec: A2uiResources, lang: A2uiLang): A2uiResourceTile[] {
  const w = TILE_WORDS[lang];
  const tiles: A2uiResourceTile[] = [];
  if (spec.cpu !== undefined) {
    const { percent, history, cores } = spec.cpu;
    const metric: Omit<A2uiMetric, "label"> = {
      value: percent,
      max: 100,
      unit: "%",
      warn: MARKS.share.warn,
      danger: MARKS.share.danger,
    };
    if (cores !== undefined) metric.detail = w.cores(cores);
    if (history !== undefined) metric.history = history;
    tiles.push({ key: "cpu", metric });
  }
  if (spec.memory !== undefined) {
    const { history, total } = spec.memory;
    const metric = usageMetric(spec.memory, spec.memory.unit ?? "GB", MARKS.share);
    if (history !== undefined) metric.history = history.map((p) => round((p * total) / 100));
    tiles.push({ key: "memory", metric });
  }
  if (spec.swap !== undefined) {
    tiles.push({
      key: "swap",
      metric: usageMetric(spec.swap, spec.swap.unit ?? "GB", MARKS.share),
    });
  }
  if (spec.load !== undefined) {
    const { one, five, fifteen, cores } = spec.load;
    const averages = [one, five, fifteen].filter((v): v is number => v !== undefined);
    const detail = [w.cores(cores)];
    if (averages.length > 1) detail.unshift(averages.map((v) => formatNumber(v, lang)).join(" / "));
    tiles.push({
      key: "load",
      metric: {
        value: one,
        max: cores * MARKS.loadPerCore.danger,
        warn: cores * MARKS.loadPerCore.warn,
        danger: cores * MARKS.loadPerCore.danger,
        detail: detail.join(" · "),
      },
    });
  }
  if (spec.uptimeSec !== undefined) {
    const s = spec.uptimeSec;
    const metric: Omit<A2uiMetric, "label"> =
      s >= 86_400
        ? { value: round(s / 86_400, 1), unit: w.days }
        : s >= 3_600
          ? { value: round(s / 3_600, 1), unit: w.hours }
          : { value: Math.floor(s / 60), unit: w.minutes };
    tiles.push({ key: "uptime", metric });
  }
  return tiles;
}

/** The tone resolveMetric gives a reading, without "done" (no board reading is a job). */
function toneOf(metric: Omit<A2uiMetric, "label">): A2uiResourceTone | undefined {
  const { tone } = resolveMetric({ label: "", ...metric });
  return tone === "attention" || tone === "danger" ? tone : undefined;
}

/**
 * The board's judgement with the fixed marks: CPU, memory and swap past 80 % need attention and
 * past 95 % are danger; a disk past 85 % / 95 %; the load at or past one per core / two per core.
 * Every tone is resolveMetric's over the same items the tiles and the text use, so the three agree.
 */
export function resolveResources(spec: A2uiResources): A2uiResolvedResources {
  const resolved: A2uiResolvedResources = { disks: [] };
  for (const tile of resourcesTiles(spec, "en")) {
    if (tile.key === "uptime") continue;
    const tone = toneOf(tile.metric);
    if (tone !== undefined) resolved[tile.key] = tone;
  }
  resolved.disks = (spec.disks ?? []).map((disk) => {
    const unit = disk.unit ?? "GB";
    const out: A2uiResolvedDisk = {
      path: disk.path,
      used: disk.used,
      total: disk.total,
      unit,
      share: disk.used / disk.total,
    };
    const tone = toneOf(diskMetric(disk));
    if (tone !== undefined) out.tone = tone;
    return out;
  });
  return resolved;
}

const LABELS = {
  en: {
    cpu: "CPU",
    memory: "Memory",
    swap: "Swap",
    load: "Load",
    uptime: "Uptime",
    disk: "Disk",
    network: "Network",
    colon: ": ",
    over: (range: string, n: number) => `${range} over ${n} readings`,
  },
  zh: {
    cpu: "CPU",
    memory: "内存",
    swap: "交换",
    load: "负载",
    uptime: "运行时间",
    disk: "磁盘",
    network: "网络",
    colon: "：",
    over: (range: string, n: number) => `近 ${n} 次 ${range}`,
  },
} as const;

/** "22–45%": the range of a percent history. */
function percentRange(history: readonly number[], lang: A2uiLang): string {
  const min = Math.min(...history);
  const max = Math.max(...history);
  return min === max
    ? formatValue(min, "%", lang)
    : `${formatNumber(min, lang)}–${formatValue(max, "%", lang)}`;
}

/**
 * A valid board as Markdown bullets under its host: each tile as the metrics item line (CPU and
 * memory add the range of their history), each disk as a used-of-total line with its tone, the
 * network's latest rates. The caller appends the "As of" foot.
 */
export function resourcesMarkdown(spec: A2uiResources, lang: A2uiLang): string[] {
  const t = LABELS[lang];
  const out: string[] = [];
  if (spec.host) out.push(`**${spec.host}**`, "");
  const tiles = new Map(resourcesTiles(spec, lang).map((tile) => [tile.key, tile.metric]));
  const line = (key: A2uiResourceKey, history?: readonly number[]): void => {
    const metric = tiles.get(key);
    if (metric === undefined) return;
    const item: A2uiMetric = { label: t[key], ...metric };
    if (history !== undefined && history.length > 0) {
      const own = item.detail ?? metricDetail(item, lang);
      const range = t.over(percentRange(history, lang), history.length);
      item.detail = own === undefined ? range : `${own} · ${range}`;
    }
    out.push(metricLine(item, lang));
  };
  line("cpu", spec.cpu?.history);
  line("memory", spec.memory?.history);
  line("swap");
  for (const disk of spec.disks ?? []) {
    out.push(metricLine({ label: `${t.disk} ${disk.path}`, ...diskMetric(disk) }, lang));
  }
  if (spec.network !== undefined) {
    const { unit, rx, tx } = spec.network;
    const rate = (values: readonly number[]) => formatValue(values.at(-1) ?? 0, unit, lang);
    out.push(`- ${t.network}${t.colon}↓ ${rate(rx)} ↑ ${rate(tx)}`);
  }
  line("load");
  line("uptime");
  return out;
}
