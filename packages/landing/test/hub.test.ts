/**
 * The hub's build-time readers (scripts/hub/) and the list pages' filtering (src/lib/hub/filter.ts).
 *
 * Scenarios:
 * - Given a plugin package with skills, hooks and an icon but no penguin.title or
 *   penguin.description, when the hub is read, then it is shown by its id, described by its npm
 *   description, and lists what it ships.
 * - Given a benchmark whose id differs from its folder, when the hub is read, then the build fails
 *   naming that file (nothing is silently dropped).
 * - Given a leaderboard value averaging two experiments of three attempts each, when it is read,
 *   then its score is the mean of their summaries, its std the sample std of the per-attempt
 *   composites, and its cost, time and tokens the sums of one run.
 * - Given a value mixing two algorithms, when it is read, then the build fails.
 * - Given a repository without leaderboards/, when the hub is read, then the placeholder stands in
 *   and finds experiments in the flat layout; given one with leaderboards/, the placeholder is not
 *   read and experiments are found under their leaderboard.
 * - Given a waffle, when it is read, then tasks come in benchmark and task order with each
 *   entry's attempts per task, and a task an entry never ran is empty.
 * - Given a leaderboard measured on a benchmark, when the hub is read, then the benchmark links to
 *   it and the leaderboard names its algorithm by the plugin's title.
 * - Given search terms and facet choices, when a list is filtered, then every term must match,
 *   choices widen within a facet and narrow across facets, and each count says what choosing that
 *   value would show; a facet every item shares is not offered.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadHub } from "../scripts/hub/hub.mjs";
import { facetCounts, facetSplits, filterItems } from "../src/lib/hub/filter";
import type { Facet } from "../src/lib/hub/filter";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A temp tree from `{ "relative/path": contents }`. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "hub-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const plugin = (name: string, penguin: object = {}, extra: object = {}) =>
  JSON.stringify({
    name: `@penguinharness/${name}`,
    version: "1.0.0",
    description: `${name} does things.`,
    license: "Apache-2.0",
    author: { name: "Prism-Shadow", url: "https://github.com/Prism-Shadow" },
    penguin: { category: "rsi", ...penguin },
    ...extra,
  });

const benchmark = (id: string) =>
  [
    `id = "${id}"`,
    `title = "${id} title"`,
    `description = "About ${id}."`,
    `version = "0.1.0"`,
    `last_update = "2026-10-29T12:00:00Z"`,
    `status = "published"`,
    `[author]`,
    `name = "Prism-Shadow"`,
  ].join("\n");

const task = (id: string, timeout?: number) =>
  [
    `id = "${id}"`,
    `title = "Task ${id}"`,
    `description = "Do ${id}."`,
    ...(timeout === undefined ? [] : ["[budget]", `timeout = ${timeout}`]),
  ].join("\n");

const meta = (id: string, algorithm?: string) =>
  [
    `experiment_id: ${id}`,
    `status: published`,
    `submit_time: "2026-10-31T12:00:00Z"`,
    `harness_name: PenguinHarness`,
    `harness_version: 0.2.19`,
    `model_name: model-a`,
    `model_provider: p`,
    `thinking_level: high`,
    ...(algorithm ? [`algorithm: ${algorithm}`] : []),
    `test_data: [bench-a]`,
    `author: { name: Prism-Shadow }`,
  ].join("\n");

const summary = (mean: number, cost: number) =>
  `time: "2026-10-31T12:00:00Z"\nscore_mean: ${mean}\nscore_std: 0\nn_attempt: 3\ncost: ${cost}\nduration_ms: 1000\nn_input_tokens: 100\nn_cache_tokens: 50\nn_output_tokens: 10\n`;

const attempt = (scores: Record<string, number>) =>
  Object.entries(scores)
    .map(
      ([taskId, score]) =>
        `- source: [{ benchmark_id: bench-a, task_id: ${taskId} }]\n  time: "2026-10-31T12:00:00Z"\n  score: ${score}\n  cost: 0\n  duration_ms: 0\n  n_input_tokens: 0\n  n_cache_tokens: 0\n  n_output_tokens: 0`,
    )
    .join("\n");

/** An experiment folder: meta plus a test phase whose attempts score tasks as given. */
function experiment(
  prefix: string,
  id: string,
  algorithm: string | undefined,
  attempts: Record<string, number>[],
  mean: number,
  cost: number,
) {
  return {
    [`${prefix}/${id}/meta_info.yaml`]: meta(id, algorithm),
    [`${prefix}/${id}/test/summary.yaml`]: summary(mean, cost),
    ...Object.fromEntries(
      attempts.map((scores, i) => [`${prefix}/${id}/test/attempt-${i + 1}.yaml`, attempt(scores)]),
    ),
  };
}

const board = (dir: string, values: string) => ({
  [`${dir}/board-a/meta_info.yaml`]:
    'leaderboard_id: board-a\ntitle: "Board A"\nauthor: { name: Prism-Shadow }\n',
  [`${dir}/board-a/table.yaml`]: `values:\n${values}`,
});

const leaf = (id: string) => `      - { experiment_id: ${id}, phase: test }\n`;

/** A repository with bench-a (tasks t1, t2) and two experiments in the flat layout. */
function repo(extra: Record<string, string> = {}) {
  return tree({
    "packages/bench-a/benchmark_config.toml": benchmark("bench-a"),
    "packages/bench-a/t1/task_config.toml": task("t1", 900),
    "packages/bench-a/t1/statement/README.md": "# t1\n\nDo it.",
    "packages/bench-a/t2/task_config.toml": task("t2"),
    ...experiment(
      "experiments",
      "exp-1",
      "toolkit",
      [
        { t1: 60, t2: 80 },
        { t1: 70, t2: 90 },
        { t1: 80, t2: 100 },
      ],
      80,
      1.5,
    ),
    ...experiment("experiments", "exp-2", "toolkit", [{ t1: 40 }, { t1: 50 }, { t1: 60 }], 50, 0.5),
    ...extra,
  });
}

function plugins() {
  return tree({
    "toolkit/package.json": plugin("toolkit", {
      title: "Toolkit",
      hooks: { version: "1", stop: [{ command: "stop.mjs" }] },
      icon: "icon.svg",
    }),
    "toolkit/icon.svg": '<svg viewBox="0 0 24 24"><path d="M1 1h2"/></svg>',
    "toolkit/skills/learn/SKILL.md":
      "---\nname: learn\ndescription: Learn from scores.\n---\n# Learn",
    "plain/package.json": plugin("plain"),
  });
}

const mean2 = `  - op: mean\n    args:\n${leaf("exp-1")}${leaf("exp-2")}`;

describe("the hub readers", () => {
  it("shows a plugin by its id and npm description when it names neither, with what it ships", () => {
    const hub = loadHub({ repo: repo(), pluginsDir: plugins(), placeholderDir: tree({}) });
    const plain = hub.details.plugin["plain"]!;
    expect(plain.title).toBe("plain");
    expect(plain.description).toBe("plain does things.");
    expect(plain.author).toEqual({
      name: "Prism-Shadow",
      homepage: "https://github.com/Prism-Shadow",
    });
    const toolkit = hub.details.plugin["toolkit"]!;
    expect(toolkit.skills).toEqual([{ name: "learn", description: "Learn from scores." }]);
    expect(toolkit.hooks).toEqual(["stop"]);
    expect(toolkit.icon).toMatch(/^data:image\/svg\+xml,/);
    expect(hub.index.plugins.find((p) => p.id === "toolkit")).toMatchObject({
      skillCount: 1,
      hookCount: 1,
    });
  });

  it("fails the build on a benchmark whose id differs from its folder", () => {
    const broken = repo({ "packages/bench-b/benchmark_config.toml": benchmark("bench-c") });
    expect(() => loadHub({ repo: broken, pluginsDir: tree({}), placeholderDir: tree({}) })).toThrow(
      /bench-b[/\\]benchmark_config\.toml: id "bench-c"/,
    );
  });

  it("averages a value's experiments, takes the std across attempt composites and sums one run", () => {
    const hub = loadHub({
      repo: repo(),
      pluginsDir: plugins(),
      placeholderDir: tree(board(".", mean2)),
    });
    const [entry] = hub.details.leaderboard["board-a"]!.charts.table!.entries;
    expect(entry!.value).toBe(65);
    // Attempt composites: mean(70, 40) = 55, mean(80, 50) = 65, mean(90, 60) = 75.
    expect(entry!.std).toBeCloseTo(10);
    expect(entry).toMatchObject({ cost: 2, durationMs: 2000, tokens: 220, algorithm: "toolkit" });
  });

  it("refuses a value whose experiments use different algorithms", () => {
    const mixed = repo(experiment("experiments", "exp-3", "other", [{ t1: 1 }], 1, 1));
    const values = `  - op: mean\n    args:\n${leaf("exp-1")}${leaf("exp-3")}`;
    expect(() =>
      loadHub({ repo: mixed, pluginsDir: tree({}), placeholderDir: tree(board(".", values)) }),
    ).toThrow(/share harness, model, algorithm and phase/);
  });

  it("reads the repository's own leaderboards, with experiments under them, over the placeholder", () => {
    const own = tree({
      "packages/bench-a/benchmark_config.toml": benchmark("bench-a"),
      ...board("leaderboards", `${leaf("exp-9")}`.replace("      - ", "  - ")),
      ...experiment("experiments/board-a", "exp-9", undefined, [{ t1: 90 }], 90, 1),
    });
    const placeholder = tree({ "other/meta_info.yaml": "leaderboard_id: other\n" });
    const hub = loadHub({ repo: own, pluginsDir: tree({}), placeholderDir: placeholder });
    expect(hub.index.leaderboards.map((b) => b.id)).toEqual(["board-a"]);
    expect(hub.details.leaderboard["board-a"]!.charts.table!.entries[0]).toMatchObject({
      value: 90,
      algorithm: null,
    });
  });

  it("orders the waffle's tasks and leaves a task an entry never ran empty", () => {
    const values = `  - { experiment_id: exp-1, phase: test }\n  - { experiment_id: exp-2, phase: test }\n`;
    const placeholder = tree({
      ...board(".", values),
      "board-a/waffle.yaml": `values:\n${values}`,
    });
    const hub = loadHub({ repo: repo(), pluginsDir: tree({}), placeholderDir: placeholder });
    const waffle = hub.details.leaderboard["board-a"]!.charts.waffle!;
    expect(waffle.tasks).toEqual([
      { benchmarkId: "bench-a", taskIds: ["t1"] },
      { benchmarkId: "bench-a", taskIds: ["t2"] },
    ]);
    expect(waffle.rows.map((row) => row.scores)).toEqual([
      [
        [60, 70, 80],
        [80, 90, 100],
      ],
      [[40, 50, 60], []],
    ]);
  });

  it("links a benchmark to the leaderboards measured on it and names algorithms by plugin title", () => {
    const hub = loadHub({
      repo: repo(),
      pluginsDir: plugins(),
      placeholderDir: tree(board(".", mean2)),
    });
    expect(hub.details.benchmark["bench-a"]!.leaderboards).toEqual([
      { id: "board-a", title: "Board A" },
    ]);
    expect(hub.details.leaderboard["board-a"]!.algorithms).toEqual([
      { id: "toolkit", title: "Toolkit" },
    ]);
    expect(hub.index.benchmarks[0]).toMatchObject({ taskCount: 2, maxTimeout: null });
  });
});

describe("filtering a hub list", () => {
  interface Item {
    name: string;
    tags: string[];
    owner: string;
  }
  const items: Item[] = [
    { name: "Alpha Toolkit", tags: ["skills"], owner: "a" },
    { name: "Beta Toolkit", tags: ["hooks"], owner: "a" },
    { name: "Gamma", tags: ["skills", "hooks"], owner: "b" },
  ];
  const facets: Facet<Item>[] = [
    { id: "tags", values: (item) => item.tags },
    { id: "owner", values: (item) => [item.owner] },
  ];
  const texts = (item: Item) => [item.name];
  const run = (query: string, selection: Record<string, string[]>) =>
    filterItems(items, { query, texts, facets, selection }).map((item) => item.name);

  it("matches every term, widens within a facet, narrows across facets, and counts what a choice shows", () => {
    expect(run("toolkit ALPHA", {})).toEqual(["Alpha Toolkit"]);
    expect(run("", { tags: ["skills", "hooks"] })).toEqual([
      "Alpha Toolkit",
      "Beta Toolkit",
      "Gamma",
    ]);
    expect(run("", { tags: ["hooks"], owner: ["a"] })).toEqual(["Beta Toolkit"]);
    const counts = facetCounts(items, facets[0]!, {
      query: "",
      texts,
      facets,
      selection: { owner: ["a"] },
    });
    expect(counts).toEqual([
      { value: "skills", count: 1 },
      { value: "hooks", count: 1 },
    ]);
    expect(facetSplits(items, { id: "all", values: () => ["x"] })).toBe(false);
    expect(
      facetSplits(items, { id: "some", values: (item) => (item.owner === "b" ? ["x"] : []) }),
    ).toBe(true);
  });
});
