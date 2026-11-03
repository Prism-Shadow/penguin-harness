/**
 * Readers for the site's Plugins, Benchmarks and Leaderboards pages. They read the source files
 * where they live — this repository's `plugins/` and a checkout of penguin-harness-benchmark
 * (see source.mjs) — at build time, and hand the pages plain records; nothing is copied into
 * this package.
 *
 * File formats: plugins follow the plugin `package.json` (RFC-0003), benchmarks
 * `benchmark_config.toml` / `task_config.toml` with their statement and rubric, plus the optional
 * `data/<benchmark-id>/` folder (RFC-0001), experiments `meta_info.yaml`, `<phase>/summary.yaml`
 * and `<phase>/attempt-<n>.yaml` (RFC-0002), and leaderboards one `leaderboard.yaml` (RFC-0005).
 * A file that breaks its format fails the build: a page silently missing a benchmark is worse
 * than a deploy that waits for the source to be fixed. Only what is `published` is shown: a
 * benchmark or leaderboard still in review (`draft`) is read past.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

export const PLUGINS_SOURCE = "https://github.com/Prism-Shadow/penguin-harness/tree/main/plugins";
export const BENCHMARK_SOURCE = "https://github.com/Prism-Shadow/penguin-harness-benchmark";

const ID = /^[A-Za-z0-9-]+$/;
/** The most data files one task lists; the folder link shows the rest. */
const MAX_TASK_FILES = 200;

/** Sub-directories of `dir` in name order; none when `dir` does not exist. */
function subdirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

const readText = (file) => readFileSync(file, "utf8");
const optionalText = (file) => (existsSync(file) ? readText(file) : undefined);

function fail(file, message) {
  throw new Error(`${file}: ${message}`);
}

function requireText(record, key, file) {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") fail(file, `${key} is required`);
  return value;
}

function optionalString(value) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/** `{ name, homepage? }` from an RFC author table or npm's `author` (a string or `{ name, url }`). */
function readAuthor(value) {
  if (typeof value === "string") {
    const match = /^([^<(]+?)\s*(?:<[^>]*>)?\s*(?:\(([^)]+)\))?$/.exec(value.trim());
    const name = match?.[1]?.trim();
    if (!name) return undefined;
    return match[2] ? { name, homepage: match[2] } : { name };
  }
  if (value && typeof value === "object" && typeof value.name === "string") {
    const homepage = optionalString(value.homepage) ?? optionalString(value.url);
    return homepage ? { name: value.name, homepage } : { name: value.name };
  }
  return undefined;
}

/** The YAML frontmatter of a Markdown file, or `{}` when it has none. */
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const parsed = parseYaml(match[1]);
  return parsed && typeof parsed === "object" ? parsed : {};
}

const svgDataUrl = (svg) => `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;

/** Every plugin package under `pluginsDir` (one directory per package, `package.json` its manifest). */
export function readPlugins(pluginsDir) {
  const plugins = [];
  for (const dirName of subdirs(pluginsDir)) {
    const dir = join(pluginsDir, dirName);
    const file = join(dir, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readText(file));
    const penguin = pkg.penguin && typeof pkg.penguin === "object" ? pkg.penguin : {};
    const packageName = requireText(pkg, "name", file);
    const id = packageName.replace(/^@[^/]+\//, "");
    if (!ID.test(id)) fail(file, `plugin id "${id}" may hold only letters, digits and "-"`);
    const description = optionalString(penguin.description) ?? optionalString(pkg.description);
    if (description === undefined) fail(file, "a description is required");
    const iconPath = optionalString(penguin.icon);
    const quickStart = penguin.quick_start;
    const hooks = penguin.hooks && typeof penguin.hooks === "object" ? penguin.hooks : {};
    plugins.push({
      id,
      packageName,
      title: optionalString(penguin.title) ?? id,
      titleZh: optionalString(penguin.title_zh),
      description,
      descriptionZh: optionalString(penguin.description_zh),
      short: optionalString(penguin.short_description) ?? description,
      shortZh: optionalString(penguin.short_description_zh),
      category: optionalString(penguin.category) ?? "other",
      version: requireText(pkg, "version", file),
      license: optionalString(pkg.license),
      author: readAuthor(pkg.author),
      preinstall: penguin.preinstall !== false,
      icon:
        iconPath && existsSync(join(dir, iconPath))
          ? svgDataUrl(readText(join(dir, iconPath)))
          : undefined,
      references: stringList(penguin.references),
      quickStart:
        quickStart && typeof quickStart.prompt === "string"
          ? {
              prompt: quickStart.prompt,
              promptZh: optionalString(quickStart.prompt_zh),
              skills: stringList(quickStart.skills),
            }
          : undefined,
      skills: subdirs(join(dir, "skills"))
        .filter((name) => existsSync(join(dir, "skills", name, "SKILL.md")))
        .map((name) => {
          const meta = frontmatter(readText(join(dir, "skills", name, "SKILL.md")));
          return {
            name: optionalString(meta.name) ?? name,
            description: optionalString(meta.short_description) ?? optionalString(meta.description),
            descriptionZh: optionalString(meta.short_description_zh),
          };
        }),
      hooks: Object.keys(hooks).filter((key) => Array.isArray(hooks[key])),
      workbenches: subdirs(join(dir, "workbenches")),
      readme: optionalText(join(dir, "README.md")),
      sourceUrl: `${PLUGINS_SOURCE}/${dirName}`,
    });
  }
  return plugins;
}

/**
 * A task's folder under `data/<benchmark-id>/tasks/`: the one its statement links to, else the
 * task id without its `CASE-NNN-` prefix, when that folder has files.
 */
function taskDataName(benchmarkId, taskId, statement, folders) {
  const linked = new RegExp(`/data/${benchmarkId}/tasks/([^/\\s)#?]+)`).exec(statement)?.[1];
  for (const name of [linked, taskId.replace(/^CASE-\d+-/, ""), taskId]) {
    if (name && folders.has(name)) return name;
  }
  return undefined;
}

/**
 * The top level of a data folder from its file paths: each file, and each directory with the
 * number of files under it; directories first, then by name.
 */
function dataEntries(paths) {
  const entries = new Map();
  for (const path of paths) {
    const [head, ...rest] = path.split("/");
    const entry = entries.get(head) ?? { name: head, dir: rest.length > 0, files: 0 };
    entry.files += 1;
    entries.set(head, entry);
  }
  return [...entries.values()].sort(
    (a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name),
  );
}

/**
 * Every Benchmark package under `<repo>/packages`, its tasks included. `dataFiles` lists the
 * repository's files under `data/` (paths from the repository root): a checkout carries only the
 * small text files, so the listing comes from git rather than the disk.
 */
export function readBenchmarks(repo, dataFiles = []) {
  const root = join(repo, "packages");
  const benchmarks = [];
  for (const dirName of subdirs(root)) {
    const dir = join(root, dirName);
    const file = join(dir, "benchmark_config.toml");
    if (!existsSync(file)) continue;
    const config = parseToml(readText(file));
    if (config.id !== dirName) fail(file, `id "${config.id}" does not match its directory`);
    if (requireText(config, "status", file) !== "published") continue;
    const author = readAuthor(config.author);
    if (author === undefined) fail(file, "[author] name is required");
    const dataPrefix = `data/${dirName}/`;
    const ownData = dataFiles.filter((path) => path.startsWith(dataPrefix));
    const taskFolders = new Map();
    for (const path of ownData) {
      const match = /^tasks\/([^/]+)\/(.+)$/.exec(path.slice(dataPrefix.length));
      if (match) taskFolders.set(match[1], [...(taskFolders.get(match[1]) ?? []), match[2]]);
    }
    const tasks = subdirs(dir)
      .filter((name) => existsSync(join(dir, name, "task_config.toml")))
      .map((name) => {
        const taskFile = join(dir, name, "task_config.toml");
        const task = parseToml(readText(taskFile));
        if (task.id !== name) fail(taskFile, `id "${task.id}" does not match its directory`);
        const budget = task.budget && typeof task.budget === "object" ? task.budget : {};
        const statement = optionalText(join(dir, name, "statement", "README.md")) ?? "";
        const dataName = taskDataName(dirName, name, statement, taskFolders);
        return {
          id: name,
          title: requireText(task, "title", taskFile),
          titleZh: optionalString(task.title_zh),
          description: requireText(task, "description", taskFile),
          descriptionZh: optionalString(task.description_zh),
          budget: Object.fromEntries(
            ["timeout", "cpus", "ram", "disk", "gpus"]
              .filter((key) => typeof budget[key] === "number")
              .map((key) => [key, budget[key]]),
          ),
          statement,
          rubric: optionalText(join(dir, name, "rubric", "README.md")) ?? "",
          data: dataName
            ? {
                url: `${BENCHMARK_SOURCE}/tree/main/${dataPrefix}tasks/${dataName}`,
                instruction: optionalText(
                  join(repo, dataPrefix, "tasks", dataName, "instruction.md"),
                ),
                files: taskFolders.get(dataName).sort().slice(0, MAX_TASK_FILES),
                fileCount: taskFolders.get(dataName).length,
              }
            : undefined,
        };
      });
    benchmarks.push({
      id: dirName,
      title: requireText(config, "title", file),
      titleZh: optionalString(config.title_zh),
      description: requireText(config, "description", file),
      descriptionZh: optionalString(config.description_zh),
      version: requireText(config, "version", file),
      lastUpdate: requireText(config, "last_update", file),
      status: requireText(config, "status", file),
      author,
      references: stringList(config.references),
      tasks,
      data:
        ownData.length > 0
          ? {
              url: `${BENCHMARK_SOURCE}/tree/main/${dataPrefix.slice(0, -1)}`,
              readme: optionalText(join(repo, dataPrefix, "README.md")),
              fileCount: ownData.length,
              entries: dataEntries(ownData.map((path) => path.slice(dataPrefix.length))),
            }
          : undefined,
      sourceUrl: `${BENCHMARK_SOURCE}/tree/main/packages/${dirName}`,
    });
  }
  return benchmarks;
}

/** An experiment's folder, filed under its leaderboard (RFC-0002). */
function experimentDir(repo, leaderboardId, experimentId) {
  const dir = join(repo, "experiments", leaderboardId, experimentId);
  return existsSync(join(dir, "meta_info.yaml")) ? dir : undefined;
}

function readYaml(file) {
  if (!existsSync(file)) fail(file, "missing");
  return parseYaml(readText(file));
}

/** One experiment phase: the experiment's meta, the phase summary and its attempts in order. */
function readPhase(repo, leaderboardId, experimentId, phase, cache, file) {
  const key = `${experimentId}/${phase}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const dir = experimentDir(repo, leaderboardId, experimentId);
  if (dir === undefined) fail(file, `experiment "${experimentId}" not found`);
  const meta = readYaml(join(dir, "meta_info.yaml"));
  const summary = readYaml(join(dir, phase, "summary.yaml"));
  const attempts = [];
  for (let n = 1; existsSync(join(dir, phase, `attempt-${n}.yaml`)); n += 1) {
    const records = readYaml(join(dir, phase, `attempt-${n}.yaml`));
    attempts.push(Array.isArray(records) ? records : []);
  }
  const path = relative(repo, dir).split(sep).join("/");
  const value = { meta, summary, attempts, url: `${BENCHMARK_SOURCE}/tree/main/${path}` };
  cache.set(key, value);
  return value;
}

/** The phase's benchmarks: `test` reads test_data, `train-N` training_data, `val-N` validation_data. */
function phaseBenchmarks(meta, phase) {
  if (phase === "test") return stringList(meta.test_data);
  if (phase.startsWith("train-")) return stringList(meta.training_data);
  if (phase.startsWith("val-")) return stringList(meta.validation_data);
  return [];
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function sampleStd(values) {
  if (values.length < 2) return null;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1));
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * Weights of a linear op over `count` arguments, or null for `div`. `weighted_mean` takes its
 * weights from the expression's `weights` list, normalised to sum to one.
 */
function linearWeights(expr, count, file) {
  switch (expr.op) {
    case "mean":
      return Array(count).fill(1 / count);
    case "sum":
      return Array(count).fill(1);
    case "sub":
      if (count !== 2) fail(file, "sub takes two args");
      return [1, -1];
    case "weighted_mean": {
      const weights = expr.weights;
      if (!Array.isArray(weights) || weights.length !== count || !weights.every(finite)) {
        fail(file, "weighted_mean needs one numeric weight per arg (weights)");
      }
      const total = weights.reduce((sum, w) => sum + w, 0);
      return weights.map((w) => w / total);
    }
    case "div":
      if (count !== 2) fail(file, "div takes two args");
      return null;
    default:
      fail(file, `unknown op "${expr.op}"`);
  }
}

/**
 * Evaluate one value: a leaf `{ experiment_id, phase, metric }` (metric defaults to score_mean) or
 * `{ op, args }`. `value` follows the op over the leaves' summary metrics. `series` is the
 * per-attempt composite Y_j when every leaf is a score with the same number of attempts;
 * `variance` is the composite's variance from each leaf's score_std, taken as independent. RFC-0005
 * gives both standard deviations; the attempts one is preferred (see `entryFor`).
 */
function evaluate(expr, ctx) {
  if (expr && typeof expr === "object" && "experiment_id" in expr) {
    const phase = optionalString(expr.phase) ?? "test";
    const metric = optionalString(expr.metric) ?? "score_mean";
    const read = readPhase(
      ctx.repo,
      ctx.leaderboardId,
      expr.experiment_id,
      phase,
      ctx.cache,
      ctx.file,
    );
    const value = read.summary[metric];
    if (!finite(value)) fail(ctx.file, `${expr.experiment_id}/${phase}: ${metric} is not a number`);
    const score = metric === "score_mean";
    return {
      value,
      series:
        score && read.attempts.length > 0
          ? read.attempts.map((records) => mean(records.map((record) => Number(record.score))))
          : null,
      variance: score && finite(read.summary.score_std) ? read.summary.score_std ** 2 : null,
      leaves: [{ experimentId: expr.experiment_id, phase, metric, ...read }],
    };
  }
  if (!expr || typeof expr !== "object" || !Array.isArray(expr.args) || expr.args.length === 0) {
    fail(ctx.file, "a value is a leaf { experiment_id, phase, metric } or { op, args }");
  }
  const parts = expr.args.map((arg) => evaluate(arg, ctx));
  const weights = linearWeights(expr, parts.length, ctx.file);
  const combine = (values) =>
    weights === null
      ? values[0] / values[1]
      : values.reduce((sum, value, i) => sum + weights[i] * value, 0);
  const n = parts[0].series?.length ?? 0;
  const aligned = n > 0 && parts.every((part) => part.series?.length === n);
  return {
    value: combine(parts.map((part) => part.value)),
    series: aligned
      ? Array.from({ length: n }, (_, j) => combine(parts.map((part) => part.series[j])))
      : null,
    variance:
      weights !== null && parts.every((part) => part.variance !== null)
        ? parts.reduce((total, part, i) => total + weights[i] ** 2 * part.variance, 0)
        : null,
    leaves: parts.flatMap((part) => part.leaves),
  };
}

const sum = (values) => values.reduce((total, value) => total + (finite(value) ? value : 0), 0);
const distinct = (values) => [...new Set(values.filter((value) => value !== ""))];
const metaText = (value) => (value === undefined || value === null ? "" : String(value));

/**
 * The std an entry shows: across the attempts' composites when every experiment ran the same
 * number of attempts (two or more), else composed from each experiment's score_std.
 */
function entryStd(series, variance) {
  const fromAttempts = series !== null ? sampleStd(series) : null;
  if (fromAttempts !== null) return { std: fromAttempts, stdFrom: "attempts" };
  if (variance !== null) return { std: Math.sqrt(variance), stdFrom: "experiments" };
  return { std: null, stdFrom: null };
}

/** One leaderboard entry, named by the (harness, model, algorithm, phase) its leaves share. */
function entryFor(expr, ctx) {
  const { value, series, variance, leaves } = evaluate(expr, ctx);
  const first = leaves[0];
  const identity = (leaf) =>
    [leaf.meta.harness_name, leaf.meta.model_name, leaf.meta.algorithm ?? "", leaf.phase].join(
      "\n",
    );
  if (!leaves.every((leaf) => identity(leaf) === identity(first))) {
    fail(ctx.file, "the experiments of one value must share harness, model, algorithm and phase");
  }
  const tokens = (leaf) => sum([leaf.summary.n_input_tokens, leaf.summary.n_output_tokens]);
  return {
    key: identity(first).replaceAll("\n", "|"),
    harness: String(first.meta.harness_name),
    harnessVersion: distinct(leaves.map((leaf) => metaText(leaf.meta.harness_version))).join(", "),
    model: String(first.meta.model_name),
    provider: optionalString(first.meta.model_provider),
    thinking: distinct(leaves.map((leaf) => metaText(leaf.meta.thinking_level))).join(", "),
    algorithm: optionalString(first.meta.algorithm) ?? null,
    phase: first.phase,
    op: typeof expr.op === "string" ? expr.op : null,
    value,
    ...entryStd(series, variance),
    attempts: series?.length ?? 0,
    cost: sum(leaves.map((leaf) => leaf.summary.cost)),
    durationMs: sum(leaves.map((leaf) => leaf.summary.duration_ms)),
    tokens: sum(leaves.map(tokens)),
    submitted:
      leaves
        .map((leaf) => metaText(leaf.meta.submit_time))
        .sort()
        .at(-1) ?? "",
    author: readAuthor(first.meta.author),
    references: distinct(leaves.flatMap((leaf) => stringList(leaf.meta.references))),
    parts: leaves.map((leaf) => ({
      experimentId: leaf.experimentId,
      url: leaf.url,
      phase: leaf.phase,
      metric: leaf.metric,
      value: leaf.summary[leaf.metric],
      scoreStd: finite(leaf.summary.score_std) ? leaf.summary.score_std : null,
      attempts: finite(leaf.summary.n_attempt) ? leaf.summary.n_attempt : leaf.attempts.length,
      cost: finite(leaf.summary.cost) ? leaf.summary.cost : 0,
      durationMs: finite(leaf.summary.duration_ms) ? leaf.summary.duration_ms : 0,
      inputTokens: sum([leaf.summary.n_input_tokens]),
      cacheTokens: sum([leaf.summary.n_cache_tokens]),
      outputTokens: sum([leaf.summary.n_output_tokens]),
      finished: metaText(leaf.summary.time),
      benchmarks: phaseBenchmarks(leaf.meta, leaf.phase),
      harnessVersion: metaText(leaf.meta.harness_version),
      ...(leaf.meta.harness_setting && typeof leaf.meta.harness_setting === "object"
        ? { harnessSetting: leaf.meta.harness_setting }
        : {}),
    })),
    leaves,
  };
}

/**
 * The per-task grid: the tasks the entries' attempts scored (a training step can score several
 * tasks as one record), in benchmark and task order, and per entry one list of attempt scores
 * per task (empty where the entry has no record of that task).
 */
function waffle(entries) {
  const tasks = new Map();
  const rows = entries.map((entry) => {
    const scores = new Map();
    for (const leaf of entry.leaves) {
      for (const records of leaf.attempts) {
        for (const record of records) {
          const source = Array.isArray(record.source) ? record.source : [];
          const task = {
            benchmarkId: String(source[0]?.benchmark_id ?? ""),
            taskIds: source.map((item) => String(item.task_id)),
          };
          const key = `${task.benchmarkId}/${task.taskIds.join("+")}`;
          if (!tasks.has(key)) tasks.set(key, task);
          scores.set(key, [...(scores.get(key) ?? []), Number(record.score)]);
        }
      }
    }
    return { key: entry.key, scores };
  });
  const keys = [...tasks.keys()].sort((a, b) => a.localeCompare(b));
  return {
    tasks: keys.map((key) => tasks.get(key)),
    rows: rows.map((row) => ({
      key: row.key,
      scores: keys.map((key) => row.scores.get(key) ?? []),
    })),
  };
}

const publicEntry = ({ leaves, ...entry }) => entry;

/** Every published leaderboard under `<repo>/leaderboards`, one `leaderboard.yaml` each. */
export function readLeaderboards(repo) {
  const root = join(repo, "leaderboards");
  const cache = new Map();
  const leaderboards = [];
  for (const dirName of subdirs(root)) {
    const file = join(root, dirName, "leaderboard.yaml");
    if (!existsSync(file)) continue;
    const config = readYaml(file);
    if (config?.leaderboard_id !== dirName) {
      fail(file, "leaderboard_id does not match its directory");
    }
    if (!ID.test(dirName)) fail(file, 'leaderboard_id may hold only letters, digits and "-"');
    if (requireText(config, "status", file) !== "published") continue;
    const author = readAuthor(config.author);
    if (author === undefined) fail(file, "author.name is required");
    if (!Array.isArray(config.values) || config.values.length === 0) {
      fail(file, "values is required");
    }
    const ctx = { repo, leaderboardId: dirName, cache, file };
    const entries = config.values.map((value) => entryFor(value, ctx));
    leaderboards.push({
      id: dirName,
      title: requireText(config, "title", file),
      titleZh: optionalString(config.title_zh),
      author,
      entries: entries.map(publicEntry),
      waffle: waffle(entries),
      benchmarks: distinct(
        entries.flatMap((entry) => entry.parts.flatMap((part) => part.benchmarks)),
      ).sort(),
      updated:
        entries
          .map((entry) => entry.submitted)
          .sort()
          .at(-1) ?? "",
      sourceUrl: `${BENCHMARK_SOURCE}/blob/main/leaderboards/${dirName}/leaderboard.yaml`,
      experimentsUrl: `${BENCHMARK_SOURCE}/tree/main/experiments/${dirName}`,
    });
  }
  return leaderboards;
}
