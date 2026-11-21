/**
 * The whole hub as the pages see it: the readers' records joined across sources (a leaderboard
 * names its algorithms by plugin, a benchmark lists the leaderboards that measure on it and a
 * plugin those that measured it, the published index adds the plugins this repository does not
 * bundle, the market's curation picks and dresses plugins), split into the list pages' summaries
 * and one record per detail page (src/lib/hub/types.ts).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexPlugins } from "./index-rows.mjs";
import { marketFor } from "./market.mjs";
import { readPublished } from "./published.mjs";
import { readBenchmarks, readLeaderboards, readPlugins } from "./read.mjs";
import { benchmarkRepo, dataFiles } from "./source.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PLUGINS_DIR = join(HERE, "..", "..", "..", "..", "plugins");

const link = ({ id, title, titleZh }) => (titleZh ? { id, title, titleZh } : { id, title });

/**
 * Read every source and join them. `refresh` re-clones the benchmark repository; `published` is
 * what the network gave this build, the market document and the index's rows (published.mjs).
 * Either may be absent: then nothing is selected or dressed, or only the bundled plugins list.
 */
export function loadHub({
  refresh = false,
  repo = benchmarkRepo({ refresh }),
  pluginsDir = PLUGINS_DIR,
  published = readPublished(),
} = {}) {
  const library = readPlugins(pluginsDir);
  const listed = [...library, ...indexPlugins(published.index ?? [], library)];
  const { market, artOf, popularityOf } = marketFor(published.market, listed);
  const selected = new Set(market.selected);
  const plugins = listed.map((plugin) => {
    const { cover, icon, screenshots } = artOf(plugin.id);
    const popularity = popularityOf(plugin.id);
    return {
      ...plugin,
      ...(cover !== undefined ? { cover } : {}),
      // The document's icon stands in only for a package whose own icon the site cannot read.
      ...(icon !== undefined && plugin.bundled === false ? { marketIcon: icon } : {}),
      ...(selected.has(plugin.id) ? { selected: true } : {}),
      ...(popularity !== undefined ? { popularity } : {}),
      ...(screenshots !== undefined ? { screenshots } : {}),
    };
  });
  const benchmarks = readBenchmarks(repo, dataFiles(repo));
  const leaderboards = readLeaderboards(repo);
  const pluginById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const benchmarkById = new Map(benchmarks.map((benchmark) => [benchmark.id, benchmark]));

  // The leaderboards whose entries ran a plugin's algorithm: what measured it.
  const measured = (id) =>
    leaderboards.filter((board) => board.entries.some((entry) => entry.algorithm === id)).map(link);
  const pluginDetails = Object.fromEntries(
    plugins.map((plugin) => [
      plugin.id,
      { ...pluginSummary(plugin), ...plugin, leaderboards: measured(plugin.id) },
    ]),
  );

  const leaderboardDetails = Object.fromEntries(
    leaderboards.map((board) => {
      const entries = board.entries;
      const algorithms = [...new Set(entries.map((entry) => entry.algorithm).filter(Boolean))].map(
        (id) => link(pluginById.get(id) ?? { id, title: id }),
      );
      const taskTitles = {};
      for (const { benchmarkId, taskIds } of board.waffle.tasks) {
        for (const taskId of taskIds) {
          const task = benchmarkById
            .get(benchmarkId)
            ?.tasks.find((candidate) => candidate.id === taskId);
          if (task) taskTitles[`${benchmarkId}/${taskId}`] = task.title;
        }
      }
      const { benchmarks: used, ...rest } = board;
      return [
        board.id,
        {
          ...rest,
          entryCount: entries.length,
          benchmarkCount: used.length,
          benchmarks: used.map((id) => link(benchmarkById.get(id) ?? { id, title: id })),
          algorithms,
          taskTitles,
        },
      ];
    }),
  );

  const benchmarkDetails = Object.fromEntries(
    benchmarks.map((benchmark) => [
      benchmark.id,
      {
        ...benchmarkSummary(benchmark),
        ...benchmark,
        leaderboards: leaderboards
          .filter((board) => board.benchmarks.includes(benchmark.id))
          .map(link),
      },
    ]),
  );

  return {
    index: {
      plugins: plugins.map(pluginSummary),
      market,
      benchmarks: benchmarks.map(benchmarkSummary),
      leaderboards: Object.values(leaderboardDetails).map(leaderboardSummary),
    },
    details: {
      plugin: pluginDetails,
      benchmark: benchmarkDetails,
      leaderboard: leaderboardDetails,
    },
  };
}

/** What a list card and the selected carousel draw: the detail without its long parts. */
function pluginSummary(plugin) {
  const { license, references, quickStart, readme, sourceUrl, screenshots, ...rest } = plugin;
  const { skills, hooks, workbenches, ...summary } = rest;
  return {
    ...summary,
    skillCount: skills.length,
    hookCount: hooks.length,
    workbenchCount: workbenches.length,
  };
}

function benchmarkSummary(benchmark) {
  const { references, tasks, data, dataUrl, sourceUrl, ...summary } = benchmark;
  const limits = tasks.map((task) => task.budget.timeout);
  return {
    ...summary,
    taskCount: tasks.length,
    maxTimeout: limits.every((limit) => typeof limit === "number") ? Math.max(...limits) : null,
  };
}

function leaderboardSummary(board) {
  return {
    id: board.id,
    title: board.title,
    ...(board.titleZh ? { titleZh: board.titleZh } : {}),
    author: board.author,
    benchmarks: board.benchmarks.map((benchmark) => benchmark.id),
    entryCount: board.entryCount,
    benchmarkCount: board.benchmarkCount,
    updated: board.updated,
  };
}

/**
 * The site routes of the hub pages, for the static shells and the sitemap, each with the English
 * title and description its shell carries for crawlers and link previews.
 */
export function hubRoutes(hub) {
  const { index, details } = hub;
  const page = (route, title, description) => ({
    route,
    title: `${title} | PenguinHarness`,
    description,
  });
  return [
    page(
      "/plugins/",
      "Plugins",
      "The PenguinHarness plugin library: self-evolution toolkits, Skills, Hooks and workbenches.",
    ),
    ...index.plugins.map((plugin) =>
      page(`/plugins/${plugin.id}/`, plugin.title, details.plugin[plugin.id].short),
    ),
    page(
      "/benchmarks/",
      "Benchmarks",
      "PenguinHarness benchmarks: the tasks and rubrics agents are measured on.",
    ),
    ...index.benchmarks.map((benchmark) =>
      page(`/benchmarks/${benchmark.id}/`, benchmark.title, benchmark.description),
    ),
    page(
      "/leaderboards/",
      "Leaderboards",
      "PenguinHarness leaderboards: agents compared by score and cost on the benchmarks.",
    ),
    ...index.leaderboards.map((board) =>
      page(
        `/leaderboards/${board.id}/`,
        board.title,
        `${board.title}: agents compared by score and cost on the benchmarks.`,
      ),
    ),
  ];
}
