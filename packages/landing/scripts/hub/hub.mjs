/**
 * The whole hub as the pages see it: the readers' records joined across sources (a leaderboard
 * names its algorithms by plugin, a benchmark lists the leaderboards that measure on it), split
 * into the list pages' summaries and one record per detail page (src/lib/hub/types.ts).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readBenchmarks, readLeaderboards, readPlugins } from "./read.mjs";
import { benchmarkRepo, dataFiles } from "./source.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PLUGINS_DIR = join(HERE, "..", "..", "..", "..", "plugins");

const link = ({ id, title, titleZh }) => (titleZh ? { id, title, titleZh } : { id, title });

/** Read every source and join them. `refresh` re-clones the benchmark repository. */
export function loadHub({
  refresh = false,
  repo = benchmarkRepo({ refresh }),
  pluginsDir = PLUGINS_DIR,
} = {}) {
  const plugins = readPlugins(pluginsDir);
  const benchmarks = readBenchmarks(repo, dataFiles(repo));
  const leaderboards = readLeaderboards(repo);
  const pluginById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const benchmarkById = new Map(benchmarks.map((benchmark) => [benchmark.id, benchmark]));

  const pluginDetails = Object.fromEntries(
    plugins.map((plugin) => [plugin.id, { ...pluginSummary(plugin), ...plugin }]),
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

function pluginSummary(plugin) {
  const {
    description,
    descriptionZh,
    license,
    references,
    quickStart,
    readme,
    sourceUrl,
    ...rest
  } = plugin;
  const { skills, hooks, workbenches, ...summary } = rest;
  return {
    ...summary,
    skillCount: skills.length,
    hookCount: hooks.length,
    workbenchCount: workbenches.length,
  };
}

function benchmarkSummary(benchmark) {
  const { references, tasks, data, sourceUrl, ...summary } = benchmark;
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
