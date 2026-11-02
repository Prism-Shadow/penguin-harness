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

export interface PluginSummary {
  id: string;
  packageName: string;
  title: string;
  titleZh?: string;
  short: string;
  shortZh?: string;
  category: string;
  version: string;
  author?: HubAuthor;
  preinstall: boolean;
  /** The package's icon.svg as a data URL, drawn as a mask so it takes the text colour. */
  icon?: string;
  skillCount: number;
  hookCount: number;
  workbenchCount: number;
}

export interface PluginSkill {
  name: string;
  description?: string;
  descriptionZh?: string;
}

export interface PluginDetail extends PluginSummary {
  description: string;
  descriptionZh?: string;
  license?: string;
  references: string[];
  quickStart?: { prompt: string; promptZh?: string; skills: string[] };
  skills: PluginSkill[];
  /** The hook points the package answers (`stop`, `user_prompt`, …). */
  hooks: string[];
  workbenches: string[];
  readme?: string;
  sourceUrl: string;
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
}

export interface HubLink {
  id: string;
  title: string;
  titleZh?: string;
}

export interface BenchmarkDetail extends BenchmarkSummary {
  references: string[];
  tasks: BenchmarkTask[];
  /** Leaderboards with an entry measured on this benchmark. */
  leaderboards: HubLink[];
  sourceUrl: string;
}

export type ChartKind = "table" | "pareto" | "waffle";

/** One entry of a chart: an expression over experiments sharing harness, model, algorithm, phase. */
export interface LeaderboardEntry {
  key: string;
  harness: string;
  harnessVersion?: string;
  model: string;
  provider?: string;
  thinking?: string;
  /** The RSI plugin id; null for a run without one (the baseline). */
  algorithm: string | null;
  phase: string;
  /** The expression's value (a score, 0–100, for score metrics). */
  value: number;
  /** Sample standard deviation across attempts; null when there is one attempt. */
  std: number | null;
  attempts: number;
  /** One run's totals across the expression's experiments: USD, ms, input + output tokens. */
  cost: number;
  durationMs: number;
  tokens: number;
  experiments: string[];
  /** ISO 8601: the latest submission among its experiments. */
  submitted: string;
}

export interface LeaderboardChart {
  subtitle?: string;
  subtitleZh?: string;
  entries: LeaderboardEntry[];
}

/** A task the waffle shows: one, or several when a record scored a batch (a training step). */
export interface WaffleTask {
  benchmarkId: string;
  taskIds: string[];
}

export interface WaffleChart extends LeaderboardChart {
  tasks: WaffleTask[];
  /** Per entry, per task (in `tasks` order), the attempts' scores, 0–100; empty when unscored. */
  rows: { key: string; scores: number[][] }[];
}

export interface LeaderboardSummary {
  id: string;
  title: string;
  titleZh?: string;
  author: HubAuthor;
  kinds: ChartKind[];
  /** The ids of the benchmarks its entries were measured on. */
  benchmarks: string[];
  entryCount: number;
  benchmarkCount: number;
  /** ISO 8601. */
  updated: string;
}

export interface LeaderboardDetail extends Omit<LeaderboardSummary, "kinds" | "benchmarks"> {
  charts: { table?: LeaderboardChart; pareto?: LeaderboardChart; waffle?: WaffleChart };
  benchmarks: HubLink[];
  /** Titles of the algorithms (RSI plugins) the entries name. */
  algorithms: HubLink[];
  /** Task titles by `<benchmark-id>/<task-id>`, for the waffle's hover text. */
  taskTitles: Record<string, string>;
  /** The leaderboard's folder in penguin-harness-benchmark; absent while it is a placeholder. */
  sourceUrl?: string;
}

export interface HubIndex {
  plugins: PluginSummary[];
  benchmarks: BenchmarkSummary[];
  leaderboards: LeaderboardSummary[];
}
