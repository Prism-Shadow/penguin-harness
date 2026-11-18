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
 * - Given a published market document naming bundled plugins and a package nothing lists, when a
 *   build fetches it and reads the hub, then the index names the selected plugins and the
 *   carousel's leads by id in the document's order without the unknown package, a selected
 *   plugin's summary carries its cover and the mark, and its screenshots reach its detail but not
 *   the list; a plugin it does not name carries none of them.
 * - Given a market document with a popularity block, when the hub is read, then each plugin it
 *   counts carries its install and weekly counts and the rest carry none, and the market says
 *   whether the counts are placeholders or live; given a block that does not read (a count that
 *   is not a whole number), then no plugin is counted, the market names no source, and the
 *   document's selection still stands.
 * - Given a published market document that cannot be read (the network fails, it is missing, it
 *   is not JSON, it names another schema), when a build reads the hub, then the embedded document
 *   stands and the build log says so; an earlier run's copy is not served by a build, but is by
 *   the dev server.
 * - Given a local market document (PENGUIN_MARKET_DOC), when the hub is read, then it is used and
 *   the published one is not fetched; given one whose picture path leaves the assets folder, then
 *   the build fails naming the file.
 * - Given a published index listing a bundled package and several versions of packages the
 *   repository does not bundle, when the hub is read, then each of the latter lists once at its
 *   newest version, not bundled, with its row's words (its description standing in for a missing
 *   one-liner), category, contents, author and update day
 *   and the market document's cover, icon and screenshots, its repository as its source (a link
 *   that is not a web link dropped), and the bundled one is not listed twice; given an index that
 *   cannot be read, then the bundled plugins list alone and the build log says so.
 * - Given a plugin whose Skill, hook package and Workbench carry dated versions, when the hub is
 *   read, then it was updated on the newest of those days; given one whose parts carry only plain
 *   versions, then it has no update day.
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
 *   it, the leaderboard names its algorithm by the plugin's title, and that plugin's page names
 *   the leaderboard that measured it.
 * - Given search terms and facet choices, when a list is filtered, then every term must match,
 *   choices widen within a facet and narrow across facets, and each count says what choosing that
 *   value would show; a facet every item shares is not offered.
 * - Given a run's time or token count that rounds up to the next unit, when it is shown, then it
 *   is shown in that unit (1.0 h, not 60 min; 1.0M, not 1000K).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHub } from "../scripts/hub/hub.mjs";
import {
  fetchPublished,
  MARKET_DOCUMENT_URL,
  PLUGIN_INDEX_URL,
  readPublished,
} from "../scripts/hub/published.mjs";
import type { Published } from "../scripts/hub/published.mjs";
import { facetCounts, facetSplits, filterItems } from "../src/lib/hub/filter";
import type { Facet } from "../src/lib/hub/filter";
import { formatCompact, formatDuration } from "../src/lib/hub/text";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
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

/** The hub over fixture folders, with nothing from the network unless a case gives it. */
const load = (options: Parameters<typeof loadHub>[0] = {}) =>
  loadHub({ published: {}, ...options });

/** A market document in a temp folder; its path. */
const market = (doc: object) => join(tree({ "market.json": JSON.stringify(doc) }), "market.json");

/** A schema-1 market document selecting `selected` (the first may lead), dressing `plugins`. */
const doc = (selected: string[], plugins: object = {}) => ({
  schema: 1,
  updated: "2026-11-17",
  hero: selected.slice(0, 1),
  selected,
  plugins,
});

/**
 * Selects plain, a package nothing lists and toolkit (the first two may lead) and dresses plain
 * and the unknown package.
 */
const MARKET = {
  ...doc(["@penguinharness/plain", "@penguinharness/ghost", "@penguinharness/toolkit"], {
    "@penguinharness/plain": {
      cover: { src: "plain/cover.webp", thumb: "plain/cover-640.webp", tone: "#112233" },
      screenshots: [{ src: "plain/shot-1.png", caption: "One", captionZh: "一" }],
    },
    "@penguinharness/ghost": { cover: { src: "ghost/cover.webp" } },
  }),
  hero: ["@penguinharness/plain", "@penguinharness/ghost"],
};

/** The embedded document of the network cases: it selects photo alone. */
const EMBEDDED = doc(["@penguinharness/photo"]);

/**
 * The network, faked at `fetch`: each URL answers its document (an object as JSON, a string as
 * is), an Error is a failed request, and any other URL is a 404. `asked` records the URLs.
 */
function network(answers: Record<string, unknown>) {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => {
    asked.push(url);
    const answer = answers[url];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) return new Response("Not Found", { status: 404 });
    return new Response(typeof answer === "string" ? answer : JSON.stringify(answer));
  };
  return { fetchImpl, asked };
}

/**
 * What a build reads after fetching from `answers` into `cacheDir`: the copies it kept, else the
 * embedded document (EMBEDDED unless given).
 */
async function fetched(
  answers: Record<string, unknown>,
  {
    cacheDir = tree({}),
    env = {},
    refresh = true,
    embedded = market(EMBEDDED),
  }: { cacheDir?: string; env?: Record<string, string>; refresh?: boolean; embedded?: string } = {},
): Promise<Published> {
  await fetchPublished({ refresh, env, cacheDir, fetchImpl: network(answers).fetchImpl });
  return readPublished({ env, cacheDir, embeddedMarket: embedded });
}

/** An index row: the fields the server requires, and `extra`. */
const row = (name: string, version: string, extra: object = {}) => ({
  name,
  version,
  description: `${name} at ${version}.`,
  authors: ["Acme Labs"],
  license: "MIT",
  ...extra,
});

/** 2025-11-17, noon UTC, in the index's seconds. */
const NOV_17 = 1763380800;

/** The first bytes of a PNG: as much of one as its format is told by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const mean2 = `  - op: mean\n    args:\n${leaf("exp-1")}${leaf("exp-2")}`;

describe("the hub readers", () => {
  it("shows a plugin by its id and npm description when its card names neither, and lists exactly what it declares", () => {
    const hub = load({ repo: repo(), pluginsDir: plugins() });
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
    const hub = load({ repo: repo(), pluginsDir: plugins() });
    expect(hub.details.plugin["toolkit"]!.icon).toEqual({
      url: expect.stringMatching(/^data:image\/svg\+xml,/),
      tint: true,
    });
    expect(hub.details.plugin["photo"]!.icon).toEqual({
      url: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`,
      tint: false,
    });
    const mislabelled = plugins({ "photo/icon.png": "<svg></svg>" });
    expect(() => load({ repo: repo(), pluginsDir: mislabelled })).toThrow(
      /photo[/\\]icon\.png: its bytes are not the image format its name says/,
    );
  });

  it("fails the build on a plugin package that was never built", () => {
    const unbuilt = tree({ "fresh/package.json": plugin("fresh") });
    expect(() => load({ repo: repo(), pluginsDir: unbuilt })).toThrow(
      /fresh[/\\]ifaces\.json: missing; build the plugins first/,
    );
  });

  it("names the published curation's plugins by id and gives the selected ones their art", async () => {
    const published = await fetched({ [MARKET_DOCUMENT_URL]: MARKET, [PLUGIN_INDEX_URL]: [] });
    const hub = load({ repo: repo(), pluginsDir: plugins(), published });
    expect(hub.index.market).toEqual({ hero: ["plain"], selected: ["plain", "toolkit"] });
    const plain = hub.index.plugins.find((p) => p.id === "plain")!;
    expect(plain).toMatchObject({
      selected: true,
      cover: { src: "plain/cover.webp", thumb: "plain/cover-640.webp", tone: "#112233" },
    });
    expect(plain).not.toHaveProperty("screenshots");
    expect(hub.details.plugin["plain"]!.screenshots).toEqual([
      { src: "plain/shot-1.png", caption: "One", captionZh: "一" },
    ]);
    const photo = hub.details.plugin["photo"]!;
    expect(photo).not.toHaveProperty("selected");
    expect(photo).not.toHaveProperty("cover");
    expect(photo).not.toHaveProperty("screenshots");
  });

  it("gives the plugins the document counts their installs and weekly installs", async () => {
    const popularity = (items: object, source = "placeholder") => ({
      ...MARKET,
      popularity: { source, generatedAt: "2026-11-17", items },
    });
    const read = async (doc: object) => {
      const published = await fetched({ [MARKET_DOCUMENT_URL]: doc, [PLUGIN_INDEX_URL]: [] });
      const hub = load({ repo: repo(), pluginsDir: plugins(), published });
      return { hub, byId: (id: string) => hub.index.plugins.find((p) => p.id === id)! };
    };
    const counted = await read(
      popularity({
        "@penguinharness/toolkit": { installs: 120, weekly: 7 },
        "@penguinharness/ghost": { installs: 1, weekly: 1 },
      }),
    );
    expect(counted.byId("toolkit").popularity).toEqual({ installs: 120, weekly: 7 });
    expect(counted.byId("plain")).not.toHaveProperty("popularity");
    expect(counted.hub.index.market.popularitySource).toBe("placeholder");

    const live = await read(
      popularity({ "@penguinharness/toolkit": { installs: 3, weekly: 1 } }, "live"),
    );
    expect(live.hub.index.market.popularitySource).toBe("live");

    const fractional = await read(
      popularity({ "@penguinharness/toolkit": { installs: 1.5, weekly: 0 } }),
    );
    expect(fractional.hub.index.plugins.some((p) => p.popularity !== undefined)).toBe(false);
    expect(fractional.hub.index.market.selected).toEqual(["plain", "toolkit"]);
    expect(fractional.hub.index.market).not.toHaveProperty("popularitySource");
  });

  it("falls back to the embedded market document when the published one cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const selected = (published: Published) =>
      load({ repo: repo(), pluginsDir: plugins(), published }).index.market.selected;
    for (const answer of [
      new Error("offline"),
      undefined,
      "{ not json",
      { ...MARKET, schema: 2 },
    ]) {
      expect(selected(await fetched({ [MARKET_DOCUMENT_URL]: answer }))).toEqual(["photo"]);
    }
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/could not read the published market document .*embedded/),
    );
    // A build drops an earlier run's copy before it fetches; the dev server still reads it.
    const cacheDir = tree({});
    await fetched({ [MARKET_DOCUMENT_URL]: MARKET }, { cacheDir });
    const dev = await fetched({}, { cacheDir, refresh: false });
    expect(selected(dev)).toEqual(["plain", "toolkit"]);
    const build = await fetched({}, { cacheDir });
    expect(selected(build)).toEqual(["photo"]);
  });

  it("reads a local market document instead of the published one, and fails the build on a broken one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchImpl, asked } = network({});
    const env = { PENGUIN_MARKET_DOC: market(MARKET) };
    const cacheDir = tree({});
    await fetchPublished({ refresh: true, env, cacheDir, fetchImpl });
    expect(asked).not.toContain(MARKET_DOCUMENT_URL);
    const published = readPublished({ env, cacheDir, embeddedMarket: market(EMBEDDED) });
    const hub = load({ repo: repo(), pluginsDir: plugins(), published });
    expect(hub.index.market.selected).toEqual(["plain", "toolkit"]);

    const escaping = market({
      ...MARKET,
      plugins: { "@penguinharness/plain": { cover: { src: "../escape.webp" } } },
    });
    expect(() => readPublished({ env: { PENGUIN_MARKET_DOC: escaping }, cacheDir })).toThrow(
      /market\.json has plugins\["@penguinharness\/plain"\]\.cover\.src that is not a picture path/,
    );
  });

  it("lists the published index's plugins that are not bundled, each once at its newest version", async () => {
    const index = [
      row("@penguinharness/plain", "9.0.0"),
      row("@acme/slides", "0.9.0"),
      row("@acme/slides", "0.10.0", {
        title: "Slides",
        titleZh: "幻灯片",
        shortDescription: "Make slides.",
        categories: ["office-productivity"],
        keywords: ["slides", "workbench", "workbenches"],
        repository: "https://github.com/acme/slides",
        integrity: "sha512-abc=",
        channels: [{ kind: "github", url: "https://example.org/releases/slides-0.10.0.tgz" }],
        updatedAt: NOV_17,
      }),
      row("@acme/slides", "0.10.0-rc.1"),
      row("@penguinharness/perler", "0.2.0", {
        descriptionZh: "拼豆图纸。",
        authors: ["Bead Co (javascript:alert%281%29)"],
        repository: "javascript:alert(1)",
      }),
    ];
    const art = doc(["@acme/slides"], {
      "@acme/slides": {
        cover: { src: "acme__slides/cover.webp" },
        icon: "acme__slides/icon.png",
        screenshots: [{ src: "acme__slides/shot-1.webp", caption: "A deck." }],
      },
    });
    const published = await fetched({ [MARKET_DOCUMENT_URL]: art, [PLUGIN_INDEX_URL]: index });
    const hub = load({ repo: repo(), pluginsDir: plugins(), published });

    expect(hub.index.plugins.filter((p) => p.packageName === "@penguinharness/plain")).toEqual([
      expect.not.objectContaining({ bundled: false }),
    ]);
    expect(hub.index.market.selected).toEqual(["acme__slides"]);
    expect(hub.index.plugins.find((p) => p.packageName === "@acme/slides")).toMatchObject({
      id: "acme__slides",
      title: "Slides",
      titleZh: "幻灯片",
      short: "Make slides.",
      description: "@acme/slides at 0.10.0.",
      version: "0.10.0",
      category: "office-productivity",
      author: { name: "Acme Labs" },
      bundled: false,
      contents: ["workbenches"],
      updated: "2025-11-17",
      selected: true,
      cover: { src: "acme__slides/cover.webp" },
      marketIcon: "acme__slides/icon.png",
      skillCount: 0,
    });
    const slides = hub.details.plugin["acme__slides"]!;
    expect(slides).toMatchObject({
      sourceUrl: "https://github.com/acme/slides",
      archiveUrl: "https://example.org/releases/slides-0.10.0.tgz",
      screenshots: [{ src: "acme__slides/shot-1.webp", caption: "A deck." }],
      skills: [],
      hooks: [],
      workbenches: [],
    });
    expect(slides).not.toHaveProperty("readme");
    const perler = hub.details.plugin["perler"]!;
    expect(perler).toMatchObject({
      short: "@penguinharness/perler at 0.2.0.",
      shortZh: "拼豆图纸。",
    });
    expect(perler).not.toHaveProperty("sourceUrl");
    expect(perler.author).toEqual({ name: "Bead Co" });
  });

  it("keeps the most recent verified index offline and rejects malformed release channels", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cacheDir = tree({});
    const entries = [
      row("@acme/cards", "1.0.0", {
        integrity: "sha512-abc=",
        channels: [{ kind: "github", url: "https://example.org/cards.tgz" }],
      }),
    ];
    await fetched({ [PLUGIN_INDEX_URL]: entries }, { cacheDir });
    const offline = await fetched({}, { cacheDir });
    expect(offline.index).toEqual(entries);
    const invalid = [{ ...entries[0], channels: [{ kind: "github", url: 7 }] }];
    const stillValid = await fetched({ [PLUGIN_INDEX_URL]: invalid }, { cacheDir });
    expect(stillValid.index).toEqual(entries);
  });

  it("lists the bundled plugins alone when the published index cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = [row("@acme/slides", "1.0.0"), { name: "@acme/half" }];
    const published = await fetched({ [PLUGIN_INDEX_URL]: broken });
    const hub = load({ repo: repo(), pluginsDir: plugins(), published });
    expect(hub.index.plugins.map((p) => p.id).sort()).toEqual(["photo", "plain", "toolkit"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /could not read the published plugin index .*malformed entry at index 1.*bundled plugins alone/,
      ),
    );
  });

  it("dates a plugin by the newest dated version among its parts", () => {
    const hub = load({
      repo: repo(),
      pluginsDir: plugins({
        "dated/package.json": plugin("dated"),
        "dated/ifaces.json": table({
          Plugin: {
            "PluginLibraryModule.cards": [{ id: "dated.card", category: "rsi" }],
            "PluginLibraryModule.skills": [{ id: "dated.skill.a", name: "a", path: "skills/a" }],
            "PluginLibraryModule.hooks": [
              { id: "dated.hooks", version: "2026.11.05.1", path: "hooks", stop: [] },
            ],
            "PluginLibraryModule.workbenches": [
              { id: "dated.workbench.desk", name: "desk", path: "workbenches/desk" },
            ],
          },
        }),
        "dated/skills/a/SKILL.md": "---\nname: a\nversion: 2026.10.02.3\n---\n# A",
        "dated/workbenches/desk/package.json": JSON.stringify({
          name: "desk",
          penguin: { version: "2026.09.01.1" },
        }),
      }),
    });
    expect(hub.index.plugins.find((p) => p.id === "dated")!.updated).toBe("2026-11-05");
    expect(hub.index.plugins.find((p) => p.id === "toolkit")).not.toHaveProperty("updated");
  });

  it("fails the build on a benchmark whose id differs from its folder", () => {
    const broken = repo({ "packages/bench-b/benchmark_config.toml": benchmark("bench-c") });
    expect(() => load({ repo: broken, pluginsDir: tree({}) })).toThrow(
      /bench-b[/\\]benchmark_config\.toml: id "bench-c"/,
    );
  });

  it("leaves draft benchmarks and leaderboards out", () => {
    const hub = load({
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
    const hub = load({ repo: withData, pluginsDir: tree({}) });
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
    const hub = load({ repo: repo(board(mean2)), pluginsDir: plugins() });
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
    const hub = load({ repo: uneven, pluginsDir: tree({}) });
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
    expect(() => load({ repo: mixed, pluginsDir: tree({}) })).toThrow(
      /share harness, model, algorithm and phase/,
    );
  });

  it("orders the waffle's tasks and leaves a task an entry never ran empty", () => {
    const values = `  - { experiment_id: exp-1, phase: test }\n  - { experiment_id: exp-2 }\n`;
    const hub = load({ repo: repo(board(values)), pluginsDir: tree({}) });
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
    const hub = load({ repo: repo(board(mean2)), pluginsDir: plugins() });
    expect(hub.details.benchmark["bench-a"]!.leaderboards).toEqual([
      { id: "board-a", title: "Board board-a" },
    ]);
    expect(hub.details.leaderboard["board-a"]!.algorithms).toEqual([
      { id: "toolkit", title: "Toolkit" },
    ]);
    expect(hub.details.plugin["toolkit"]!.leaderboards).toEqual([
      { id: "board-a", title: "Board board-a" },
    ]);
    expect(hub.details.plugin["plain"]!.leaderboards).toEqual([]);
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

describe("a run's time and tokens", () => {
  afterEach(() => setActiveStrings(zh));

  it("carry a figure that rounds up into the next unit", () => {
    setActiveStrings(en);
    // Picking the unit before rounding would print 60 min, 1000K, 100.0K and 1000.
    expect(formatDuration(59.6 * 60_000)).toBe("1.0 h");
    expect(formatCompact(999_500)).toBe("1.0M");
    expect(formatCompact(99_960)).toBe("100K");
    expect(formatCompact(999.6)).toBe("1.0K");
    // Just below the carry the unit is unchanged.
    expect(formatDuration(59.4 * 60_000)).toBe("59 min");
    expect(formatCompact(999_499)).toBe("999K");
    expect(formatCompact(99_940)).toBe("99.9K");
  });
});
