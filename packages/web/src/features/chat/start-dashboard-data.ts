/**
 * What the start page shows, decided without React (start-dashboard.tsx renders it; unit tested
 * in test/start-dashboard-data.test.ts): the toolkit cards and their order, a Benchmark's latest
 * evaluation, the order of the Evaluation Center rows, and whether the selected agent has a
 * toolkit.
 */

/** A method row as the ordering reads it (`RSI_METHODS` rows are a superset). */
export interface ToolkitMethodLike {
  readonly id: string;
  readonly plugin: string;
}

/** The plugin fields the start page reads (`PluginItem` is a superset). */
export interface ToolkitPluginLike {
  readonly name: string;
  readonly skills: readonly { readonly name: string }[];
}

/** One toolkit card: the method row it stands for, if any, and its plugin once loaded. */
export interface ToolkitEntry<M extends ToolkitMethodLike, P extends ToolkitPluginLike> {
  readonly key: string;
  readonly method: M | null;
  readonly plugin: P | null;
}

/**
 * The toolkit cards in display order. Before the library has answered (`plugins` null) there is
 * one card per method row, so the grid has its final shape from the first paint. Once it has,
 * the methods' own plugins come first, in method order — the default loop leads, as it does in
 * the Method select — and a row whose plugin the library does not carry is dropped; any other
 * plugin of the category follows, by name.
 */
export function orderToolkits<M extends ToolkitMethodLike, P extends ToolkitPluginLike>(
  plugins: readonly P[] | null,
  methods: readonly M[],
): ToolkitEntry<M, P>[] {
  if (plugins === null) {
    return methods.map((method) => ({ key: method.plugin, method, plugin: null }));
  }
  const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]));
  const known = methods.flatMap((method) => {
    const plugin = byName.get(method.plugin);
    return plugin === undefined ? [] : [{ key: plugin.name, method, plugin }];
  });
  const named = new Set(methods.map((method) => method.plugin));
  const others = plugins
    .filter((plugin) => !named.has(plugin.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((plugin) => ({ key: plugin.name, method: null, plugin }));
  return [...known, ...others];
}

/** The fields of an evaluation the start page orders by and shows. */
export interface EvaluationLike {
  readonly time: string;
  readonly score: number;
}

/** An ISO time as a number to order by; one that does not parse orders as the oldest. */
function timeOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * A Benchmark's latest evaluation: the newest by time among those with a finite Score — a
 * malformed record has no number to show — and of two at the same time the one later in the
 * scoreboard. Null when nothing is scored.
 */
export function latestEvaluation<E extends EvaluationLike>(evaluations: readonly E[]): E | null {
  let latest: E | null = null;
  for (const evaluation of evaluations) {
    if (typeof evaluation.score !== "number" || !Number.isFinite(evaluation.score)) continue;
    if (latest === null || timeOf(evaluation.time) >= timeOf(latest.time)) latest = evaluation;
  }
  return latest;
}

/** The Benchmark fields the start page orders by (`BenchmarkSummary` is a superset). */
export interface BenchmarkLike {
  readonly id: string;
  readonly title: string;
  readonly evaluations: readonly EvaluationLike[];
}

/**
 * The Evaluation Center section's order: the Benchmarks with an evaluation first, the most
 * recently evaluated on top, then the rest by title (and by id, so equal titles keep one order).
 */
export function sortBenchmarks<B extends BenchmarkLike>(benchmarks: readonly B[]): B[] {
  const keyed = benchmarks.map((benchmark) => {
    const latest = latestEvaluation(benchmark.evaluations);
    return { benchmark, at: latest === null ? null : timeOf(latest.time) };
  });
  keyed.sort((x, y) => {
    if (x.at !== null && y.at === null) return -1;
    if (x.at === null && y.at !== null) return 1;
    if (x.at !== null && y.at !== null && x.at !== y.at) return y.at > x.at ? 1 : -1;
    return (
      x.benchmark.title.localeCompare(y.benchmark.title) ||
      x.benchmark.id.localeCompare(y.benchmark.id)
    );
  });
  return keyed.map((entry) => entry.benchmark);
}

/**
 * Whether the selected agent has a toolkit: every Skill the plugin ships is among the agent's
 * installed Skills. A partial copy — an older version that shipped fewer, or one with a Skill
 * removed — is not: the card then offers the install, which completes it, since the demo may
 * need any of them. A plugin without Skills is never a toolkit the agent has.
 */
export function isInstalled(
  plugin: { readonly skills: readonly { readonly name: string }[] },
  installed: ReadonlySet<string>,
): boolean {
  return plugin.skills.length > 0 && plugin.skills.every((skill) => installed.has(skill.name));
}

/** Every evaluation the Benchmarks have recorded: the evaluations tile's number. */
export function evaluationCount(
  benchmarks: readonly { readonly evaluations: readonly unknown[] }[],
): number {
  return benchmarks.reduce((sum, benchmark) => sum + benchmark.evaluations.length, 0);
}

/** A quick start as the library carries it (`QuickStartItem` is a superset). */
export interface QuickStartLike {
  readonly prompt: string;
  readonly promptZh?: string;
  readonly skills?: readonly string[];
}

/** What a toolkit card's Start puts in the composer, in both languages, with the Skills it pins. */
export interface ToolkitDemo {
  readonly prompt: string;
  readonly promptZh?: string;
  readonly skills: readonly string[];
}

/**
 * A toolkit's demo, by the Plugins page's rule: the quick start its plugin.json declares, else
 * its first Skill invoked by name (`invoke` words that request); null for a plugin with neither.
 * A quick start that pins no Skills pins the plugin's first.
 */
export function toolkitDemo(
  plugin: ToolkitPluginLike & { readonly quickStart?: QuickStartLike },
  invoke: (skill: string) => string,
): ToolkitDemo | null {
  const first = plugin.skills[0]?.name;
  const quickStart = plugin.quickStart;
  if (quickStart !== undefined) {
    const pinned =
      quickStart.skills !== undefined && quickStart.skills.length > 0
        ? quickStart.skills
        : first !== undefined
          ? [first]
          : [];
    return {
      prompt: quickStart.prompt,
      ...(quickStart.promptZh !== undefined ? { promptZh: quickStart.promptZh } : {}),
      skills: pinned,
    };
  }
  return first === undefined ? null : { prompt: invoke(first), skills: [first] };
}
