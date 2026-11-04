/**
 * The `resources` block (a2ui/resources.ts): one machine's snapshot, built from the basic charts.
 *
 * - Given a full snapshot, it round-trips with no issue; one section alone is a valid board.
 * - Given no section at all, it is an error that names the sections it could have.
 * - Given an impossible reading — used above total, a whole of 0, a percent over 100, a negative
 *   rate, rx and tx of different lengths, a fractional core count, two disks on one path — each
 *   is an error at its path and the spec is withheld.
 * - The fixed marks colour the board, not the model: CPU, memory and swap from 80 % need
 *   attention and from 95 % are danger, a disk from 85 % / 95 %, the load from one / two per
 *   core; below the marks a section is calm.
 * - Each tile is a metrics item whose tone is that judgement, and its words (cores, the uptime's
 *   unit) are in the reader's language.
 * - As text: a line per reading in the metrics item's voice (CPU and memory with the range of
 *   their history), each disk with its tone, the network's latest rates, the uptime, then the
 *   "As of" foot; zh labels.
 */
import { describe, expect, it } from "vitest";
import {
  parseA2ui,
  resolveMetric,
  resolveResources,
  resourcesTiles,
  toFallbackMarkdown,
  type A2uiResources,
} from "../src/a2ui/index.js";

const parse = (value: unknown) => parseA2ui(JSON.stringify(value));
const errorPaths = (value: unknown) =>
  parse(value)
    .issues.filter((issue) => issue.level === "error")
    .map((issue) => [issue.code, issue.path]);

const board: A2uiResources = {
  type: "resources",
  host: "build-01",
  cpu: { percent: 82, history: [22, 31, 45, 40, 82], cores: 8 },
  memory: { used: 13.9, total: 16, unit: "GB", history: [70, 75, 87] },
  swap: { used: 0.5, total: 2 },
  disks: [
    { path: "/", used: 120, total: 500 },
    { path: "/data", used: 1.9, total: 2, unit: "TB" },
  ],
  network: { unit: "KB/s", rx: [80, 120], tx: [35, 40] },
  load: { one: 4.4, five: 3.1, fifteen: 2.8, cores: 4 },
  uptimeSec: 1_071_360,
  asOf: "2026-10-04T06:00:00Z",
};

describe("parseA2ui: resources", () => {
  it("a full snapshot round-trips with no issue, and one section alone is a valid board", () => {
    const full = parse(board);
    expect(full.issues).toEqual([]);
    expect(full.spec).toEqual(board);
    const one = { type: "resources", uptimeSec: 60 };
    expect(parse(one).issues).toEqual([]);
    expect(parse(one).spec).toEqual(one);
  });

  it("a board with no section is an error that names the sections", () => {
    const result = parse({ type: "resources", host: "build-01" });
    expect(result.issues.map((i) => i.code)).toEqual(["missing_field"]);
    expect(result.issues[0]!.message).toContain(
      "cpu, memory, swap, disks, network, load, uptimeSec",
    );
    expect(result.spec).toBeUndefined();
  });

  it.each([
    ["used above total", { memory: { used: 17, total: 16 } }, [["range_invalid", "memory.used"]]],
    ["a whole of 0", { swap: { used: 0, total: 0 } }, [["range_invalid", "swap.total"]]],
    ["a percent over 100", { cpu: { percent: 120 } }, [["range_invalid", "cpu.percent"]]],
    [
      "a CPU section without its percent",
      { cpu: { cores: 8 } },
      [["missing_field", "cpu.percent"]],
    ],
    [
      "a history point over 100",
      { memory: { used: 1, total: 2, history: [50, 101] } },
      [["range_invalid", "memory.history[1]"]],
    ],
    [
      "a negative rate",
      { network: { unit: "KB/s", rx: [1, -1], tx: [1, 1] } },
      [["range_invalid", "network.rx[1]"]],
    ],
    [
      "rx and tx of different lengths",
      { network: { unit: "MB/s", rx: [1, 2, 3], tx: [1, 2] } },
      [["length_mismatch", "network.tx"]],
    ],
    [
      "a fractional core count",
      { load: { one: 1, cores: 2.5 } },
      [["range_invalid", "load.cores"]],
    ],
    [
      "two disks on one path",
      {
        disks: [
          { path: "/", used: 1, total: 2 },
          { path: "/", used: 1, total: 2 },
        ],
      },
      [["duplicate_label", "disks[1].path"]],
    ],
    ["a section that is not an object", { cpu: 37 }, [["wrong_type", "cpu"]]],
  ])("rejects %s and withholds the spec", (_case, sections, expected) => {
    const input = { type: "resources", ...sections };
    expect(errorPaths(input)).toEqual(expected);
    expect(parse(input).spec).toBeUndefined();
  });
});

describe("the board's judgement", () => {
  const tone = (spec: Omit<A2uiResources, "type">) =>
    resolveResources({ type: "resources", ...spec });

  it.each([
    [79, undefined],
    [80, "attention"],
    [94.9, "attention"],
    [95, "danger"],
  ])("CPU at %s percent is %s; memory and swap at that share read the same", (pct, expected) => {
    const resolved = tone({
      cpu: { percent: pct },
      memory: { used: pct, total: 100 },
      swap: { used: pct * 20, total: 2000, unit: "MB" },
    });
    expect([resolved.cpu, resolved.memory, resolved.swap]).toEqual([expected, expected, expected]);
  });

  it("a disk needs attention from 85 % and is danger from 95 %, measured as a share of its own size", () => {
    const { disks } = tone({
      disks: [
        { path: "/", used: 84, total: 100 },
        { path: "/var", used: 425, total: 500 },
        { path: "/data", used: 1.9, total: 2, unit: "TB" },
      ],
    });
    expect(disks.map((d) => [d.path, d.share, d.tone, d.unit])).toEqual([
      ["/", 0.84, undefined, "GB"],
      ["/var", 0.85, "attention", "GB"],
      ["/data", 0.95, "danger", "TB"],
    ]);
  });

  it("the load needs attention from one per core and is danger from two per core", () => {
    expect(tone({ load: { one: 3.9, cores: 4 } }).load).toBeUndefined();
    expect(tone({ load: { one: 4, cores: 4 } }).load).toBe("attention");
    expect(tone({ load: { one: 8, cores: 4 } }).load).toBe("danger");
  });

  it("each tile is a metrics item whose tone is the board's, worded in the reader's language", () => {
    const tiles = resourcesTiles(board, "zh");
    expect(tiles.map((t) => t.key)).toEqual(["cpu", "memory", "swap", "load", "uptime"]);
    const resolved = resolveResources(board);
    for (const { key, metric } of tiles) {
      if (key === "uptime") continue;
      expect(resolveMetric({ label: key, ...metric }).tone, key).toBe(resolved[key]);
    }
    const byKey = new Map(tiles.map((t) => [t.key, t.metric]));
    expect(byKey.get("cpu")).toMatchObject({ value: 82, max: 100, unit: "%", detail: "8 核" });
    expect(byKey.get("memory")!.history).toEqual([11.2, 12, 13.92]);
    expect(byKey.get("uptime")).toEqual({ value: 12.4, unit: "天" });
    expect(resourcesTiles({ type: "resources", uptimeSec: 7_200 }, "en")[0]!.metric).toEqual({
      value: 2,
      unit: "hours",
    });
  });
});

describe("toFallbackMarkdown: resources", () => {
  // Sunday 2026-10-04, 06:05 UTC.
  const at = { now: new Date("2026-10-04T06:05:00Z"), timeZone: "UTC" };
  const fence = `\`\`\`a2ui\n${JSON.stringify(board)}\n\`\`\``;

  it("prints a line per reading, each disk with its tone, the latest rates and when it was read", () => {
    expect(toFallbackMarkdown(fence, { lang: "en", ...at })).toBe(
      [
        "**build-01**",
        "",
        "- CPU: 82% — 8 cores · 22–82% over 5 readings — warning",
        "- Memory: 13.9 GB — 13.9 / 16 GB used · 70–87% over 3 readings — warning",
        "- Swap: 0.5 GB — 0.5 / 2 GB used",
        "- Disk /: 120 GB — 120 / 500 GB used",
        "- Disk /data: 1.9 TB — 1.9 / 2 TB used — critical",
        "- Network: ↓ 120 KB/s ↑ 40 KB/s",
        "- Load: 4.4 — 4.4 / 3.1 / 2.8 · 4 cores — warning",
        "- Uptime: 12.4 days",
        "",
        "As of 06:00",
      ].join("\n"),
    );
  });

  it("speaks zh with zh labels and words", () => {
    expect(toFallbackMarkdown(fence, { lang: "zh", ...at })).toBe(
      [
        "**build-01**",
        "",
        "- CPU：82% — 8 核 · 近 5 次 22–82% — 注意",
        "- 内存：13.9 GB — 已用 13.9 / 16 GB · 近 3 次 70–87% — 注意",
        "- 交换：0.5 GB — 已用 0.5 / 2 GB",
        "- 磁盘 /：120 GB — 已用 120 / 500 GB",
        "- 磁盘 /data：1.9 TB — 已用 1.9 / 2 TB — 警告",
        "- 网络：↓ 120 KB/s ↑ 40 KB/s",
        "- 负载：4.4 — 4.4 / 3.1 / 2.8 · 4 核 — 注意",
        "- 运行时间：12.4 天",
        "",
        "数据时间 06:00",
      ].join("\n"),
    );
  });
});
