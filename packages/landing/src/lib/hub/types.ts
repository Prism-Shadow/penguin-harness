/**
 * The records the Plugins, Benchmarks and Leaderboards pages render. The build reads them from
 * the source files (scripts/hub/) and the `virtual:penguin-hub` module hands them over: one index
 * of summaries for the lists, and one module per detail page, loaded when it is opened.
 *
 * Text fields come in pairs: `title` is English and always present, `titleZh` the Chinese one
 * when the source has it (`localized` picks between them).
 */

export interface HubAuthor {
  name: string;
  homepage?: string;
}

/**
 * A plugin's authored cover, from the market's curation document: paths under the community
 * repository's `assets/plugins/` (`pluginAssetUrl` resolves them).
 */
export interface PluginCover {
  src: string;
  /** The small rendition a card draws. */
  thumb?: string;
  /** The picture's dominant colour (`#rrggbb`). */
  tone?: string;
}

/** A screenshot on a plugin's page, from the curation document: a path and what it shows. */
export interface PluginShot {
  src: string;
  /** The small rendition the gallery row draws. */
  thumb?: string;
  caption?: string;
  captionZh?: string;
}

export interface PluginSummary {
  id: string;
  packageName: string;
  title: string;
  titleZh?: string;
  short: string;
  shortZh?: string;
  /** The full description: the selected carousel shows it beside the cover. */
  description: string;
  descriptionZh?: string;
  category: string;
  version: string;
  author?: HubAuthor;
  preinstall: boolean;
  /** The package's icon as a data URL; `tint` (a monochrome SVG) draws it as a mask in the tile's ink. */
  icon?: { url: string; tint: boolean };
  skillCount: number;
  hookCount: number;
  workbenchCount: number;
  /** The authored cover; absent, the page draws the generated one. */
  cover?: PluginCover;
  /**
   * A raster icon from the curation document (a path, like the cover's), for a plugin that is not
   * bundled and so has no `icon` of its own.
   */
  marketIcon?: string;
  /** In the market's selected list. */
  selected?: true;
  /**
   * Its install count and its installs in the last week, from the market document's popularity
   * block: what the Plugins page's ranking and its Popular order read. Placeholder numbers until a
   * real source replaces them; absent when the document carries none for it.
   */
  popularity?: { installs: number; weekly: number };
  /**
   * Listed by the published plugin index, not shipped from this repository's plugins/: its page
   * has no README, Skills, hook points or quick start, since the build downloads no package.
   */
  bundled?: false;
  /**
   * What a plugin that is not bundled says it carries (its index keywords `skills`, `hooks`,
   * `workbenches`); a bundled one's counts say it instead.
   */
  contents?: ("skills" | "hooks" | "workbenches")[];
  /**
   * The newest day (ISO 8601 date) among the dated versions of its Skills, hook package and
   * Workbenches; absent when none is dated. The only ordering signal besides the curation.
   */
  updated?: string;
}

export interface PluginSkill {
  name: string;
  description?: string;
  descriptionZh?: string;
}

export interface PluginDetail extends PluginSummary {
  license?: string;
  references: string[];
  quickStart?: { prompt: string; promptZh?: string; skills: string[] };
  skills: PluginSkill[];
  /** The hook points the package answers (`stop`, `user_prompt`, …). */
  hooks: string[];
  workbenches: string[];
  readme?: string;
  /** Its folder on GitHub; for a plugin that is not bundled, its repository, when the index names one. */
  sourceUrl?: string;
  /** An HTTPS release archive pinned by the registry. */
  archiveUrl?: string;
  /** The screenshots the curation document gives it, in order. */
  screenshots?: PluginShot[];
  /** The leaderboards whose entries ran it (an RSI toolkit's algorithm): what measured it. */
  leaderboards: HubLink[];
}

export interface BenchmarkSummary {
  id: string;
  title: string;
  titleZh?: string;
  description: string;
  descriptionZh?: string;
  version: string;
  /** ISO 8601. */
  lastUpdate: string;
  status: string;
  author: HubAuthor;
  taskCount: number;
  /** The longest time limit any task sets, in seconds; null when a task sets none. */
  maxTimeout: number | null;
}

export interface BenchmarkTask {
  id: string;
  title: string;
  titleZh?: string;
  description: string;
  descriptionZh?: string;
  /** Seconds, cores, GB, GB, cards; a missing key is unlimited. */
  budget: Partial<Record<"timeout" | "cpus" | "ram" | "disk" | "gpus", number>>;
  /** The statement's README.md (Markdown). */
  statement: string;
  /** The rubric's README.md (Markdown). */
  rubric: string;
  /** The task's folder under `data/`, when it has one. */
  data?: TaskData;
}

export interface TaskData {
  /** The folder on GitHub. */
  url: string;
  /** Its instruction.md (Markdown), the prompt the agent is given. */
  instruction?: string;
  /** Paths inside the folder, sorted; capped, so `fileCount` can be larger. */
  files: string[];
  fileCount: number;
}

export interface BenchmarkData {
  /** `data/<benchmark-id>/` on GitHub. */
  url: string;
  /** Its README.md (Markdown). */
  readme?: string;
  fileCount: number;
  /** Its top level: directories (with the files under them) first, then files. */
  entries: { name: string; dir: boolean; files: number }[];
}

export interface HubLink {
  id: string;
  title: string;
  titleZh?: string;
}

export interface BenchmarkDetail extends BenchmarkSummary {
  references: string[];
  tasks: BenchmarkTask[];
  data?: BenchmarkData;
  /** Leaderboards with an entry measured on this benchmark. */
  leaderboards: HubLink[];
  sourceUrl: string;
}

export type ChartKind = "table" | "pareto" | "waffle";

/** One experiment an entry reads: its summary for the phase, and the meta it ran with. */
export interface LeaderboardPart {
  experimentId: string;
  /** The experiment's folder on GitHub. */
  url: string;
  phase: string;
  metric: string;
  /** The metric's value in the phase summary. */
  value: number;
  scoreStd: number | null;
  attempts: number;
  /** USD, ms and token counts of one run. */
  cost: number;
  durationMs: number;
  inputTokens: number;
  cacheTokens: number;
  outputTokens: number;
  /** ISO 8601: when the phase finished. */
  finished: string;
  /** The benchmark ids the phase ran on. */
  benchmarks: string[];
  harnessVersion: string;
  harnessSetting?: Record<string, unknown>;
}

/** One entry: an expression over experiments sharing harness, model, algorithm and phase. */
export interface LeaderboardEntry {
  key: string;
  harness: string;
  /** Distinct versions across its experiments, comma-separated. */
  harnessVersion: string;
  model: string;
  provider?: string;
  /** Distinct thinking levels across its experiments, comma-separated. */
  thinking: string;
  /** The RSI plugin id; null for a run without one (the baseline). */
  algorithm: string | null;
  phase: string;
  /** The expression's top-level op; null for a single experiment. */
  op: string | null;
  /** The expression's value (a score, 0–100, for score metrics). */
  value: number;
  /** Sample standard deviation; null when it cannot be told. */
  std: number | null;
  /** Across the attempts' composite scores, or composed from each experiment's score_std. */
  stdFrom: "attempts" | "experiments" | null;
  /** Attempts behind the attempts std; 0 when it was not used. */
  attempts: number;
  /** One run's totals across the expression's experiments: USD, ms, input + output tokens. */
  cost: number;
  durationMs: number;
  tokens: number;
  /** ISO 8601: the latest submission among its experiments. */
  submitted: string;
  author?: HubAuthor;
  references: string[];
  parts: LeaderboardPart[];
}

/** A task the waffle shows: one, or several when a record scored a batch (a training step). */
export interface WaffleTask {
  benchmarkId: string;
  taskIds: string[];
}

export interface WaffleGrid {
  tasks: WaffleTask[];
  /** Per entry (in `entries` order), per task, the attempts' scores, 0–100; empty when unscored. */
  rows: { key: string; scores: number[][] }[];
}

export interface LeaderboardSummary {
  id: string;
  title: string;
  titleZh?: string;
  author: HubAuthor;
  /** The ids of the benchmarks its entries were measured on. */
  benchmarks: string[];
  entryCount: number;
  benchmarkCount: number;
  /** ISO 8601. */
  updated: string;
}

export interface LeaderboardDetail extends Omit<LeaderboardSummary, "benchmarks"> {
  entries: LeaderboardEntry[];
  waffle: WaffleGrid;
  benchmarks: HubLink[];
  /** Titles of the algorithms (RSI plugins) the entries name. */
  algorithms: HubLink[];
  /** Task titles by `<benchmark-id>/<task-id>`, for the waffle's rows. */
  taskTitles: Record<string, string>;
  /** The leaderboard.yaml on GitHub. */
  sourceUrl: string;
  /** The folder its experiments live in on GitHub. */
  experimentsUrl: string;
}

/**
 * The market's curation, by plugin id: the selected plugins in display order, and those of them
 * allowed to lead the selected carousel, in turn order.
 */
export interface HubMarket {
  hero: string[];
  selected: string[];
  /**
   * Where the plugins' popularity counts come from, when the market document carries any:
   * generated placeholders today, a real install count once one is connected.
   */
  popularitySource?: "placeholder" | "live";
}

export interface HubIndex {
  plugins: PluginSummary[];
  market: HubMarket;
  benchmarks: BenchmarkSummary[];
  leaderboards: LeaderboardSummary[];
}
