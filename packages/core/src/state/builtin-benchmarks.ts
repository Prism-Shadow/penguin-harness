/**
 * The built-in Benchmarks: what one is, and the writer that puts it on disk.
 *
 * Five Benchmarks ship beside the example, PenguinHarness Benchmark Sec A to Sec E: subsets of
 * rag-bench-essential, DeepSWE v1.1, AutomationBench, Terminal-Bench-Science 0.1 and
 * Terminal-Bench 4.0, each chosen to run on CPU-only Docker. Their tasks are Harbor task
 * directories that live in the public benchmark repository, never in this one: each Case here
 * is text only — a statement that summarises the task, links its folder in the repository at
 * the pinned commit and the repository's rules for running a task, and gives the exact Harbor
 * launch with its caps; and a rubric that is the verifier's reward out of 100.
 * `benchmark_config.toml` is a plain Benchmark config (title, description, runs, status) that
 * marks nothing: how a case is run is its statement's to say, and the agent-evaluation Skill
 * reads it there. Case directories are `CASE-NNN-<task>`, so the Harbor task name is the case id
 * without its `CASE-NNN-` prefix.
 *
 * They are written when a Project is created (project-benchmarks.ts), and a deleted one stays
 * deleted. The cases themselves are data (builtin-benchmarks-data.ts): cutting a Benchmark down
 * to its final task list is deleting rows there, and the case numbers follow the rows' order.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { stringify as stringifyYaml } from "yaml";
import {
  BENCHMARK_REPO,
  BENCHMARK_REPO_REF,
  BENCHMARK_RESULTS,
  BENCHMARK_RUN_RULES,
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

/** One built-in Benchmark: its card, the facts every statement repeats, and its cases. */
export interface BuiltinBenchmark {
  /** Directory under `benchmarks/`, which is the Benchmark id: `penguinharness-benchmark-sec-<letter>`. */
  id: string;
  /** "PenguinHarness Benchmark Sec <letter>". */
  title: string;
  /** Opens with the original benchmark the section is ("Sec A is …"), then what every built-in shares. */
  description: string;
  /** The benchmark's directory in the benchmark repository, which keeps the source's name: its tasks are `benchmarks/<repoDir>/tasks`. */
  repoDir: string;
  /** The source as the statements name it, e.g. a Harbor Hub dataset and its revision. */
  source: string;
  /** The upstream project the tasks come from, and its licence. */
  upstream: { url: string; license: string };
  /** Agent-phase network of the tasks: open, or none except the model provider's API host. */
  agentNetwork: "public" | "no-network";
  /** Trials may join the host's shared `penguin-bench` Docker network (the repository allows it for these). */
  sharedNetwork: boolean;
  /** Where the task's verifier runs. */
  verifier: string;
  /** What the evaluating machine downloads besides nodejs.org, npm and the model provider. */
  downloads: string;
  /** Per-trial caps of the measured runs: the adapter's soft timeout and the Agent's turn cap. */
  runTimeout: string;
  maxTurns: number;
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
  return `benchmarks/${bench.repoDir}/tasks`;
}

/** A link into the benchmark repository at the pinned revision: a folder (`tree`) or a file (`blob`). */
function repoLink(kind: "tree" | "blob", rel: string): string {
  return `${BENCHMARK_REPO}/${kind}/${BENCHMARK_REPO_REF}/${rel}`;
}

/** A plain Benchmark config, like any other: nothing in it marks how the cases run. */
function benchmarkConfig(bench: BuiltinBenchmark): Record<string, unknown> {
  return { title: bench.title, description: bench.description, runs: 1, status: "published" };
}

/**
 * The statement README: summary, provenance and resources, then how the case is run — the
 * repository's rules for agents, the exact launch with its caps — and how it is scored.
 */
function statement(bench: BuiltinBenchmark, item: BuiltinBenchmarkCase): string {
  const offline = bench.agentNetwork === "no-network";
  const facts = [
    `- Benchmark: ${bench.title} — ${bench.source} · Category: ${item.category}` +
      (item.expertHours !== undefined ? ` · Expert estimate: ${item.expertHours} h` : ""),
    `- Task: \`${item.task}\` in ${repoLink("tree", `${taskPath(bench)}/${item.task}`)}`,
    `- Upstream: ${bench.upstream.url} (${bench.upstream.license})`,
    `- Container: ${item.cpus} CPU, ${item.memoryMb / 1024} GB RAM, CPU only · Agent network: ` +
      (offline ? "none, except the model provider's API host" : "public") +
      ` · Verifier: ${bench.verifier}`,
  ];
  const command = [
    'export PYTHONPATH="$PWD/agents"',
    `uvx --from harbor==${HARBOR_VERSION} harbor run -p ${taskPath(bench)} -i ${item.task} \\`,
    `  -a ${HARBOR_AGENT} -m <provider>/<model_id> \\`,
    "  --ak thinking=<level> --ak penguin_version=<penguin version> \\",
    `  --ak run_timeout=${bench.runTimeout} --ak max_turns=${bench.maxTurns} \\`,
    ...(offline ? ["  --allow-agent-host <model provider API host> \\"] : []),
    ...(bench.sharedNetwork
      ? ["  --extra-docker-compose tools/docker/shared-network.yaml \\"]
      : []),
    "  --agent-setup-timeout-multiplier 2.5 -k 1 -n 1 --job-name <job name> -o <jobs dir> -y",
  ];
  return [
    `# ${item.title}`,
    "",
    item.summary,
    "",
    ...facts,
    "",
    "## How this case is run",
    "",
    "This case does not run in a Workspace. It is a Harbor task: the evaluator runs it in Docker " +
      `with Harbor ${HARBOR_VERSION} and the PenguinHarness adapter from the repository above, ` +
      `following that repository's rules for agents — ${repoLink("blob", BENCHMARK_RUN_RULES)} — ` +
      `from the root of a checkout at commit \`${BENCHMARK_REPO_REF}\`:`,
    "",
    "```bash",
    ...command,
    "```",
    "",
    `Caps: the agent is stopped at ${bench.runTimeout} and after ${bench.maxTurns} turns. Run at ` +
      "most four trials at a time on one machine. Prerequisites on the evaluating machine: Docker " +
      `with Compose v2; uv; network access to ${bench.downloads}, nodejs.org, the npm registry and ` +
      "the model provider; the model under test configured in this machine's PenguinHarness with " +
      "its API key saved (the adapter copies that one entry into the container, outside the " +
      "trial's log directory)." +
      (bench.note !== undefined ? ` ${bench.note}` : ""),
    "",
    "The score is the verifier's reward × 100: a pass (1) scores 100, a fail (0) scores 0, and a " +
      "fractional reward r scores 100·r. An evaluation from the Evaluation Center keeps every trial " +
      "under this Benchmark's `.jobs/` directory and records its Session id as `harbor:<trial name>`.",
    "",
    `Measured results of PenguinHarness on these tasks: ${repoLink("blob", BENCHMARK_RESULTS)}`,
    "",
  ].join("\n");
}

const RUBRIC = `# Scoring rubric (max 100 points)

- 100 pts: the Harbor verifier's reward for this trial (\`/logs/verifier/reward.txt\` or the \`reward\` key of \`reward.json\`) multiplied by 100. The task's own tests decide; there is no manual judging and no partial credit beyond what the verifier itself reports.
`;

/**
 * Writes one built-in Benchmark — config, an empty scoreboard, and every case's statement
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
