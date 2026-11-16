/**
 * The hub's build-time readers (scripts/hub/) and the list pages' filtering (src/lib/hub/filter.ts).
 *
 * Scenarios:
 * - Given a plugin package whose built table carries a card with no title, when the hub is read,
 *   then it is shown by its id and described by its npm description; given one whose table
 *   declares Skills, a hook package and an icon, then it lists exactly what it declares — not a
 *   Skill folder no entry names, nor what a module its default export leaves out contributes.
 * - Given a plugin package whose icon is a line drawing in currentColor, and one whose icon is a
 *   PNG at its root, when the hub is read, then the first is carried to be drawn in the tile's
 *   ink and the second as itself; given an icon whose bytes are not the format its name says,
 *   then the build fails naming the file.
 * - Given a plugin package that was never built (no ifaces.json), when the hub is read, then the
 *   build fails naming that file.
 * - Given a benchmark whose id differs from its folder, when the hub is read, then the build fails
 *   naming that file (nothing is silently dropped).
 * - Given a draft benchmark and a draft leaderboard, when the hub is read, then both are left
 *   out.
 * - Given a benchmark with a data folder, when it is read, then each task carries its rubric and
 *   finds its data folder by the link in its statement or by its id without the CASE prefix, and a
 *   task with neither has no data.
 * - Given a leaderboard value averaging two experiments of three attempts each, when it is read,
 *   then its score is the mean of their summaries, its std the sample std of the per-attempt
 *   composites, and its cost, time and tokens the sums of one run; when the attempts do not line
 *   up, the std is composed from each experiment's score_std instead.
 * - Given a value mixing two algorithms, when it is read, then the build fails.
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
function tree(files: Record<string, string | Uint8Array>): string {
  const root = mkdtempSync(join(tmpdir(), "hub-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** A plugin's package.json: npm's fields only. */
const plugin = (name: string) =>
  JSON.stringify({
    name: `@penguinharness/${name}`,
    version: "1.0.0",
    description: `${name} does things.`,
    license: "Apache-2.0",
    author: { name: "Prism-Shadow", url: "https://github.com/Prism-Shadow" },
  });

/**
 * A plugin's built table as `gen-ifaces` writes it: the modules with what each contributes, and
 * the ones the default export names (`listed`).
 */
const table = (modules: Record<string, Record<string, object[]>>, listed = ["Plugin"]) =>
  JSON.stringify({
    ifaces: {},
    types: {},
    modules: Object.fromEntries(
      Object.entries(modules).map(([name, contributes]) => [
        name,
        { name, kind: "component", requires: {}, provides: {}, contributes, children: [] },
      ]),
    ),
    plugin: { modules: listed, replaces: [] },
  });

const benchmark = (id: string, status = "published") =>
  [
    `id = "${id}"`,
    `title = "${id} title"`,
    `description = "About ${id}."`,
    `version = "0.1.0"`,
    `last_update = "2026-10-29T12:00:00Z"`,
    `status = "${status}"`,
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

const summary = (mean: number, cost: number, std = 0) =>
  `time: "2026-10-31T12:00:00Z"\nscore_mean: ${mean}\nscore_std: ${std}\nn_attempt: 3\ncost: ${cost}\nduration_ms: 1000\nn_input_tokens: 100\nn_cache_tokens: 50\nn_output_tokens: 10\n`;

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
  std = 0,
) {
  return {
    [`${prefix}/${id}/meta_info.yaml`]: meta(id, algorithm),
    [`${prefix}/${id}/test/summary.yaml`]: summary(mean, cost, std),
    ...Object.fromEntries(
      attempts.map((scores, i) => [`${prefix}/${id}/test/attempt-${i + 1}.yaml`, attempt(scores)]),
    ),
  };
}

const board = (values: string, id = "board-a", status = "published") => ({
  [`leaderboards/${id}/leaderboard.yaml`]: `leaderboard_id: ${id}\ntitle: "Board ${id}"\nstatus: ${status}\nauthor: { name: Prism-Shadow }\nvalues:\n${values}`,
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
      "experiments/board-a",
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
    ...experiment(
      "experiments/board-a",
      "exp-2",
      "toolkit",
      [{ t1: 40 }, { t1: 50 }, { t1: 60 }],
      50,
      0.5,
    ),
    ...extra,
  });
}

function plugins(extra: Record<string, string | Uint8Array> = {}) {
  return tree({
    "toolkit/package.json": plugin("toolkit"),
    "toolkit/ifaces.json": table({
      Plugin: {
        "PluginLibraryModule.cards": [
          { id: "toolkit.card", title: "Toolkit", category: "rsi", icon: "icon.svg" },
        ],
        "PluginLibraryModule.skills": [
          { id: "toolkit.skill.learn", name: "learn", path: "skills/learn" },
        ],
        "PluginLibraryModule.hooks": [
          { id: "toolkit.hooks", version: "1", path: "hooks", stop: [{ command: "stop.mjs" }] },
        ],
      },
      // A module the default export does not name: what it contributes is not the plugin's.
      Spare: {
        "PluginLibraryModule.skills": [
          { id: "toolkit.skill.spare", name: "spare", path: "skills/spare" },
        ],
      },
    }),
    "toolkit/icon.svg":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 1h2"/></svg>',
    "toolkit/skills/learn/SKILL.md":
      "---\nname: learn\ndescription: Learn from scores.\n---\n# Learn",
    "toolkit/skills/spare/SKILL.md": "---\nname: spare\ndescription: Spare.\n---\n# Spare",
    "toolkit/skills/draft/SKILL.md": "---\nname: draft\ndescription: Undeclared.\n---\n# Draft",
    "plain/package.json": plugin("plain"),
    "plain/ifaces.json": table({
      Plugin: { "PluginLibraryModule.cards": [{ id: "plain.card", category: "rsi" }] },
    }),
    "photo/package.json": plugin("photo"),
    "photo/ifaces.json": table({
      Plugin: { "PluginLibraryModule.cards": [{ id: "photo.card", category: "rsi" }] },
    }),
    "photo/icon.png": PNG,
    ...extra,
  });
}

/** The first bytes of a PNG: as much of one as its format is told by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const mean2 = `  - op: mean\n    args:\n${leaf("exp-1")}${leaf("exp-2")}`;

describe("the hub readers", () => {
  it("shows a plugin by its id and npm description when its card names neither, and lists exactly what it declares", () => {
    const hub = loadHub({ repo: repo(), pluginsDir: plugins() });
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
    expect(plain.icon).toBeUndefined();
    expect(hub.index.plugins.find((p) => p.id === "toolkit")).toMatchObject({
      skillCount: 1,
      hookCount: 1,
    });
  });

  it("carries a line icon to take the tile's ink and a PNG icon as itself, and fails on a mislabelled one", () => {
    const hub = loadHub({ repo: repo(), pluginsDir: plugins() });
    expect(hub.details.plugin["toolkit"]!.icon).toEqual({
      url: expect.stringMatching(/^data:image\/svg\+xml,/),
      tint: true,
    });
    expect(hub.details.plugin["photo"]!.icon).toEqual({
      url: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`,
      tint: false,
    });
    const mislabelled = plugins({ "photo/icon.png": "<svg></svg>" });
    expect(() => loadHub({ repo: repo(), pluginsDir: mislabelled })).toThrow(
      /photo[/\\]icon\.png: its bytes are not the image format its name says/,
    );
  });

  it("fails the build on a plugin package that was never built", () => {
    const unbuilt = tree({ "fresh/package.json": plugin("fresh") });
    expect(() => loadHub({ repo: repo(), pluginsDir: unbuilt })).toThrow(
      /fresh[/\\]ifaces\.json: missing; build the plugins first/,
    );
  });

  it("fails the build on a benchmark whose id differs from its folder", () => {
    const broken = repo({ "packages/bench-b/benchmark_config.toml": benchmark("bench-c") });
    expect(() => loadHub({ repo: broken, pluginsDir: tree({}) })).toThrow(
      /bench-b[/\\]benchmark_config\.toml: id "bench-c"/,
    );
  });

  it("leaves draft benchmarks and leaderboards out", () => {
    const hub = loadHub({
      repo: repo({
        "packages/bench-d/benchmark_config.toml": benchmark("bench-d", "draft"),
        ...board(mean2, "board-a"),
        ...board(mean2, "board-d", "draft"),
      }),
      pluginsDir: tree({}),
    });
    expect(hub.index.benchmarks.map((b) => b.id)).toEqual(["bench-a"]);
    expect(hub.index.leaderboards.map((b) => b.id)).toEqual(["board-a"]);
  });

  it("gives each task its rubric and finds its data folder by the statement's link or its id", () => {
    const withData = repo({
      "packages/bench-a/t1/rubric/README.md": "# Rubric\n\n100 pts.",
      "packages/bench-a/t1/statement/README.md":
        "Task: https://github.com/o/r/tree/abc/data/bench-a/tasks/first-task",
      "packages/bench-a/CASE-003-third/task_config.toml": task("CASE-003-third"),
      "data/bench-a/README.md": "# Data",
      "data/bench-a/tasks/first-task/instruction.md": "Do the first task.",
      "data/bench-a/tasks/first-task/environment/input.csv": "a,b",
      "data/bench-a/tasks/third/task.toml": "",
    });
    const hub = loadHub({ repo: withData, pluginsDir: tree({}) });
    const bench = hub.details.benchmark["bench-a"]!;
    expect(bench.data).toMatchObject({
      readme: "# Data",
      fileCount: 4,
      entries: [
        { name: "tasks", dir: true, files: 3 },
        { name: "README.md", dir: false, files: 1 },
      ],
    });
    const byId = Object.fromEntries(bench.tasks.map((t) => [t.id, t]));
    expect(byId["t1"]!.rubric).toBe("# Rubric\n\n100 pts.");
    expect(byId["t1"]!.data).toMatchObject({
      instruction: "Do the first task.",
      files: ["environment/input.csv", "instruction.md"],
    });
    expect(byId["CASE-003-third"]!.data?.files).toEqual(["task.toml"]);
    expect(byId["t2"]!.data).toBeUndefined();
  });

  it("averages a value's experiments, takes the std across attempt composites and sums one run", () => {
    const hub = loadHub({ repo: repo(board(mean2)), pluginsDir: plugins() });
    const [entry] = hub.details.leaderboard["board-a"]!.entries;
    expect(entry!.value).toBe(65);
    // Attempt composites: mean(70, 40) = 55, mean(80, 50) = 65, mean(90, 60) = 75.
    expect(entry!.std).toBeCloseTo(10);
    expect(entry).toMatchObject({
      cost: 2,
      durationMs: 2000,
      tokens: 220,
      algorithm: "toolkit",
      stdFrom: "attempts",
    });
    expect(entry!.parts.map((part) => [part.experimentId, part.value])).toEqual([
      ["exp-1", 80],
      ["exp-2", 50],
    ]);
  });

  it("composes the std from each experiment's score_std when the attempts do not line up", () => {
    const uneven = repo({
      ...experiment("experiments/board-a", "exp-4", "toolkit", [{ t1: 10 }, { t1: 30 }], 20, 1, 6),
      ...experiment("experiments/board-a", "exp-5", "toolkit", [{ t1: 50 }], 50, 1, 8),
      ...board(`  - op: mean\n    args:\n${leaf("exp-4")}${leaf("exp-5")}`),
    });
    const hub = loadHub({ repo: uneven, pluginsDir: tree({}) });
    const [entry] = hub.details.leaderboard["board-a"]!.entries;
    // sqrt((1/2)^2 * 6^2 + (1/2)^2 * 8^2) = 5
    expect(entry!.std).toBeCloseTo(5);
    expect(entry!.stdFrom).toBe("experiments");
  });

  it("refuses a value whose experiments use different algorithms", () => {
    const mixed = repo({
      ...experiment("experiments/board-a", "exp-3", "other", [{ t1: 1 }], 1, 1),
      ...board(`  - op: mean\n    args:\n${leaf("exp-1")}${leaf("exp-3")}`),
    });
    expect(() => loadHub({ repo: mixed, pluginsDir: tree({}) })).toThrow(
      /share harness, model, algorithm and phase/,
    );
  });

  it("orders the waffle's tasks and leaves a task an entry never ran empty", () => {
    const values = `  - { experiment_id: exp-1, phase: test }\n  - { experiment_id: exp-2 }\n`;
    const hub = loadHub({ repo: repo(board(values)), pluginsDir: tree({}) });
    const waffle = hub.details.leaderboard["board-a"]!.waffle;
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
    const hub = loadHub({ repo: repo(board(mean2)), pluginsDir: plugins() });
    expect(hub.details.benchmark["bench-a"]!.leaderboards).toEqual([
      { id: "board-a", title: "Board board-a" },
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
