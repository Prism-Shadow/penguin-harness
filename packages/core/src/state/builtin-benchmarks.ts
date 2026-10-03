/**
 * The built-in Harbor Benchmarks: what one is, and the writer that puts it on disk.
 *
 * Five Benchmarks ship with every Project beside the example: subsets of Terminal-Bench 4.0,
 * Terminal-Bench-Science 0.1, DeepSWE v1.1, AutomationBench and rag-bench-essential, each
 * chosen to run on CPU-only Docker. Their tasks are Harbor task directories that live in the
 * public benchmark repository, never in this one: each Case here is text only — a statement
 * that summarises the task, links its folder at the pinned ref and spells out the Harbor launch
 * line, and a rubric that is the verifier's reward out of 100. `benchmark_config.toml` marks
 * them `kind = "harbor"` and carries a `[harbor]` table (repository, ref, task folder, adapter,
 * Harbor version, the per-trial caps, an optional setup command), which is what the
 * agent-evaluation Skill's Harbor branch runs from. Case directories are `CASE-NNN-<task>`, so
 * the Harbor task name is the case id without its `CASE-NNN-` prefix.
 *
 * When one is written is project-benchmarks.ts's decision: a Project is given each built-in
 * once, and a deleted one stays deleted. The cases themselves are data
 * (builtin-benchmarks-data.ts): cutting a Benchmark down to its final task list is deleting rows
 * there, and the case numbers follow the rows' order.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { stringify as stringifyYaml } from "yaml";
import {
  BENCHMARK_REPO,
  BENCHMARK_REPO_REF,
  HARBOR_AGENT,
  HARBOR_VERSION,
} from "./builtin-benchmarks-data.js";

/** One Harbor task a built-in Benchmark carries as a Case. */
export interface BuiltinBenchmarkCase {
  /** Harbor task name: its directory under the task folder, and what `harbor run -i` selects. */
  task: string;
  /** The statement's first heading, which the case list shows as the case title. */
  title: string;
  /** What the task asks and what it delivers, in two to four sentences; never a hint at a solution. */
  summary: string;
  /** The upstream category, "<area> / <sub-area>". */
  category: string;
  cpus: number;
  memoryMb: number;
  /** Upstream expert time estimate in hours, where the source publishes one. */
  expertHours?: number;
}

/** One built-in Harbor Benchmark: its card, the facts every statement repeats, and its cases. */
export interface BuiltinBenchmark {
  /** Directory under `benchmarks/`, which is the Benchmark id; the task folder is `benchmarks/<id>/tasks` in the repository. */
  id: string;
  title: string;
  description: string;
  /** The source as the statements name it, e.g. a Harbor Hub dataset and its revision. */
  source: string;
  /** The upstream project the tasks come from, and its licence. */
  upstream: { url: string; license: string };
  /** Agent-phase network of the tasks: open, or none except the model provider's API host. */
  agentNetwork: "public" | "no-network";
  /** Where the task's verifier runs. */
  verifier: string;
  /** What the evaluating machine downloads besides nodejs.org, npm and the model provider. */
  downloads: string;
  /** Per-trial caps of the measured runs: the adapter's soft timeout and the Agent's turn cap. */
  runTimeout: string;
  maxTurns: number;
  /**
   * Set when the tasks are generated on the evaluating machine rather than stored in the
   * repository: the command that generates them in a checkout, and the upstream folder that
   * holds one case per task.
   */
  generated?: { command: string; casesUrl: string };
  /** One more sentence of running notes for every statement, when the benchmark needs one. */
  note?: string;
  cases: BuiltinBenchmarkCase[];
}

/** Case directory name: the 1-based position and the Harbor task name. */
function builtinCaseId(index: number, task: string): string {
  return `CASE-${String(index).padStart(3, "0")}-${task}`;
}

/** Folder of the Benchmark's tasks inside the benchmark repository. */
function taskPath(bench: BuiltinBenchmark): string {
  return `benchmarks/${bench.id}/tasks`;
}

function repoTree(rel: string): string {
  return `${BENCHMARK_REPO}/tree/${BENCHMARK_REPO_REF}/${rel}`;
}

function benchmarkConfig(bench: BuiltinBenchmark): Record<string, unknown> {
  return {
    title: bench.title,
    description: bench.description,
    runs: 1,
    status: "published",
    kind: "harbor",
    harbor: {
      repo: BENCHMARK_REPO,
      ref: BENCHMARK_REPO_REF,
      path: taskPath(bench),
      agent: HARBOR_AGENT,
      harbor_version: HARBOR_VERSION,
      run_timeout: bench.runTimeout,
      max_turns: bench.maxTurns,
      allow_agent_hosts: [],
      ...(bench.generated !== undefined ? { setup: bench.generated.command } : {}),
    },
  };
}

/** The statement README: summary, provenance and resources, then how the case is run and scored. */
function statement(bench: BuiltinBenchmark, item: BuiltinBenchmarkCase): string {
  const offline = bench.agentNetwork === "no-network";
  const facts = [
    `- Benchmark: ${bench.source} · Category: ${item.category}` +
      (item.expertHours !== undefined ? ` · Expert estimate: ${item.expertHours} h` : ""),
    bench.generated === undefined
      ? `- Task folder: ${repoTree(`${taskPath(bench)}/${item.task}`)}`
      : `- Task folder: \`${taskPath(bench)}/${item.task}\`, generated in a checkout by the first command below; the scripts are in ${repoTree(`benchmarks/${bench.id}`)}`,
    bench.generated === undefined
      ? `- Upstream: ${bench.upstream.url} (${bench.upstream.license})`
      : `- Upstream: ${bench.generated.casesUrl}/${item.task} (${bench.upstream.license})`,
    `- Container: ${item.cpus} CPU, ${item.memoryMb / 1024} GB RAM, CPU only · Agent network: ` +
      (offline ? "none, except the model provider's API host" : "public") +
      ` · Verifier: ${bench.verifier}`,
  ];
  const command = [
    ...(bench.generated !== undefined ? [`${bench.generated.command}   # once per checkout`] : []),
    'export PYTHONPATH="$PWD/agents"',
    `uvx --from harbor==${HARBOR_VERSION} harbor run -p ${taskPath(bench)} -i ${item.task} \\`,
    `  -a ${HARBOR_AGENT} -m <provider>/<model_id> \\`,
    "  --ak thinking=<level> --ak penguin_version=<penguin version> \\",
    `  --ak run_timeout=${bench.runTimeout} --ak max_turns=${bench.maxTurns} \\`,
    ...(offline ? ["  --allow-agent-host <model provider API host> \\"] : []),
    "  --agent-setup-timeout-multiplier 2.5 -k 1 -n 1 --job-name <job name> -o <jobs dir> -y",
  ];
  return [
    `# ${item.title}`,
    "",
    item.summary,
    "",
    ...facts,
    "",
    "## How this case is evaluated",
    "",
    "This case does not run in a Workspace. The evaluator runs it with the Harbor framework in Docker, " +
      "using the PenguinHarness agent adapter from the repository above. From the root of a checkout " +
      `of that repository at \`${BENCHMARK_REPO_REF}\`:`,
    "",
    "```bash",
    ...command,
    "```",
    "",
    "Prerequisites on the evaluating machine: Docker with Compose v2; `uv` (Harbor " +
      `${HARBOR_VERSION} needs Python 3.12 or newer, which \`uvx\` provides); network access to ` +
      `${bench.downloads}, nodejs.org, the npm registry and the model provider; and the model under ` +
      "test configured in this machine's PenguinHarness with its API key saved. The adapter copies " +
      "that one model entry into the task container, outside the trial's log directory." +
      (bench.note !== undefined ? ` ${bench.note}` : ""),
    "",
    "The score is the verifier's reward × 100: a pass (1) scores 100, a fail (0) scores 0, and a " +
      "fractional reward r scores 100·r. An evaluation from the Evaluation Center keeps every trial " +
      "under this Benchmark's `.jobs/` directory and records its Session id as `harbor:<trial name>`.",
    "",
  ].join("\n");
}

const RUBRIC = `# Scoring rubric (max 100 points)

- 100 pts: the Harbor verifier's reward for this trial (\`/logs/verifier/reward.txt\` or the \`reward\` key of \`reward.json\`) multiplied by 100. The task's own tests decide; there is no manual judging and no partial credit beyond what the verifier itself reports.
`;

/**
 * Writes one built-in Harbor Benchmark — config, an empty scoreboard, and every case's statement
 * and rubric — into `benchDir`, an existing empty directory. project-benchmarks.ts calls it on a
 * staging directory that it renames into place. Every write settles before a failure is
 * reported, so nothing is still writing into the directory once the caller removes it.
 */
export async function writeBuiltinBenchmark(
  benchDir: string,
  bench: BuiltinBenchmark,
): Promise<void> {
  const results = await Promise.allSettled([
    fs.writeFile(
      path.join(benchDir, "benchmark_config.toml"),
      `${stringifyToml(benchmarkConfig(bench))}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(benchDir, "scoreboard.yaml"),
      stringifyYaml({ evaluations: [] }),
      "utf8",
    ),
    ...bench.cases.map(async (item, i) => {
      const caseDir = path.join(benchDir, builtinCaseId(i + 1, item.task));
      await fs.mkdir(path.join(caseDir, "statement"), { recursive: true });
      await fs.mkdir(path.join(caseDir, "rubric"), { recursive: true });
      await fs.writeFile(
        path.join(caseDir, "statement", "README.md"),
        statement(bench, item),
        "utf8",
      );
      await fs.writeFile(path.join(caseDir, "rubric", "README.md"), RUBRIC, "utf8");
    }),
  ]);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed !== undefined) throw failed.reason;
}
