/**
 * Provisioning of the example Benchmark.
 *
 * When default_agent is initialized, it preprovisions `benchmarks/example-benchmark/`: two
 * sample cases (each with statement/ and rubric/ indexed by a README.md),
 * benchmark_config.toml (runs = 2), and a scoreboard.yaml with three sample evaluations —
 * so the evaluation center has data out of the box. Its description states plainly that this
 * is a built-in example and the whole directory can be deleted or replaced. Only
 * default_agent gets this; ordinary Agents do not.
 *
 * Scoring numbers follow the current Scoreboard contract: every Case is scored out of 100;
 * Case metrics are model-written Run averages and Evaluation metrics are model-written Case
 * averages. Cost ignores unknown values; Run cost preserves its recorded precision, Score
 * averages keep two decimals, cost averages keep six, and durations are rounded to integer
 * milliseconds.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { stringify as stringifyYaml } from "yaml";
import { benchmarksDir } from "./paths.js";

/** Directory name of the example Benchmark (the directory name is also its identifier). */
export const EXAMPLE_BENCHMARK_ID = "example-benchmark";

/** Contents of benchmark_config.toml (no model reference here — the model is recorded on each evaluation instead). */
const EXAMPLE_BENCHMARK_CONFIG = {
  title: "Example Benchmark",
  description:
    "A built-in example benchmark so the evaluation charts have data out of the box. " +
    "Replace it with your own.",
  runs: 2,
};

/** Two sample cases: statement and scoring rubric (in English, 3-5 lines each). */
const EXAMPLE_CASES: Array<{ id: string; statement: string; rubric: string }> = [
  {
    id: "CASE-001-file-summary",
    statement: `# Task: Summarize a project file

Read the provided \`notes.txt\` in your workspace and write \`summary.md\` containing:
1. A one-paragraph overview of at most 3 sentences.
2. A bullet list of the three most important facts.
Keep the whole summary under 150 words.
`,
    rubric: `# Scoring rubric (max 100 points)

- 40 pts: \`summary.md\` exists and stays under 150 words.
- 40 pts: The three bullet facts are accurate and taken from \`notes.txt\`.
- 20 pts: The overview paragraph is coherent and at most 3 sentences.
Award partial credit per item; the case score is the sum.
`,
  },
  {
    id: "CASE-002-data-cleanup",
    statement: `# Task: Clean up a CSV dataset

The workspace contains \`users.csv\` with duplicate rows and inconsistent casing in the email column.
Produce \`users_clean.csv\` where:
1. Emails are lowercased and rows with an empty email are removed.
2. Exact duplicate rows are dropped, keeping the first occurrence.
Do not change the column order.
`,
    rubric: `# Scoring rubric (max 100 points)

- 40 pts: \`users_clean.csv\` exists and keeps the original column order.
- 40 pts: Emails are lowercased, empty-email rows removed, duplicates dropped (first kept).
- 20 pts: No unrelated rows or columns were modified.
Award partial credit per item; the case score is the sum.
`,
  },
];

/** Raw result of a single Run in the current Scoreboard format. */
interface ExampleRun {
  score: number;
  cost: number | null;
  duration_ms: number;
  session_id: string;
}

/**
 * Example provenance fingerprints (illustrative only — not computed from a real Agent). The
 * three rounds share the same tools/skills hashes (nothing was installed or uninstalled) while
 * the system prompt hash and the top-level agent hash change each round: this is exactly the
 * localization story provenance is meant to tell — "the prompt changed, the skills didn't". Real
 * fingerprints come from `penguin provenance`.
 */
const EXAMPLE_TOOLS_SHA = "08910c743d74efbbe547657603461d72c8fea7361e3bbc88e6a9cac896374ef3";
const EXAMPLE_SKILLS_SHA = "69bf7c0181bb8cc80044504c9681ff87b34b706811f1bb6a5f17eb642ceb497e";
const EXAMPLE_AGENTS_MD_SHA =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** A shape-valid 64-char hex string seeded by `tag` + `v` (illustrative, not a real digest). */
function fakeHex(tag: string, v: number): string {
  const seed = `${tag}${v}`;
  let hex = "";
  for (let i = 0; hex.length < 64; i += 1) {
    hex += (((seed.charCodeAt(i % seed.length) * 7 + i * 31 + v) % 16) & 0xf).toString(16);
  }
  return hex.slice(0, 64);
}

/** Builds an illustrative provenance block for example version `v` (fake but shape-valid hashes). */
function exampleProvenance(v: number): Record<string, unknown> {
  return {
    provenance_version: 1,
    version: v,
    // Changes each round (the prompt was edited every version).
    system_prompt_sha256: fakeHex("sysprompt", v),
    agents_md_sha256: EXAMPLE_AGENTS_MD_SHA,
    // Constant across rounds (no tool/skill install or uninstall).
    tools_sha256: EXAMPLE_TOOLS_SHA,
    skills_sha256: EXAMPLE_SKILLS_SHA,
    model: { provider: "deepseek", model_id: "deepseek-v4-pro" },
    thinking_level: "medium",
    // Top-level fingerprint changes each round because the prompt hash feeds into it.
    agent_sha256: fakeHex("agent", v),
  };
}

/**
 * Raw runs for the three sample evaluations (case-level and evaluation-level metrics are
 * computed from these, keeping the numbers self-consistent). Each carries the model actually
 * used for that round; the examples all use deepseek-v4-pro at medium thinking.
 */
const EXAMPLE_EVALUATIONS: Array<{
  time: string;
  version: number;
  provider: string;
  model_id: string;
  thinking_level: string;
  summary_title: string;
  summary: string;
  cases: Array<{ case: string; runs: ExampleRun[] }>;
}> = [
  {
    time: "2026-07-14T09:30:00Z",
    version: 1,
    provider: "deepseek",
    model_id: "deepseek-v4-pro",
    thinking_level: "medium",
    summary_title: "Baseline before any optimization",
    summary:
      "Example data (not a real evaluation): baseline scores of the built-in sample " +
      "benchmark before any optimization. Hypothesis for the next round: the agent skips " +
      "a final self-check, losing points on completeness.",
    cases: [
      {
        case: "CASE-001-file-summary",
        runs: [
          {
            score: 50,
            cost: 0.012,
            duration_ms: 42000,
            session_id: "session-2026-07-14-09-05-11-1a2b3c01",
          },
          {
            score: 70,
            cost: 0.014,
            duration_ms: 48000,
            session_id: "session-2026-07-14-09-13-27-1a2b3c02",
          },
        ],
      },
      {
        case: "CASE-002-data-cleanup",
        runs: [
          {
            score: 60,
            cost: null,
            duration_ms: 66000,
            session_id: "session-2026-07-14-09-21-45-1a2b3c03",
          },
          {
            score: 60,
            cost: null,
            duration_ms: 74000,
            session_id: "session-2026-07-14-09-28-52-1a2b3c04",
          },
        ],
      },
    ],
  },
  {
    time: "2026-07-15T09:30:00Z",
    version: 2,
    provider: "deepseek",
    model_id: "deepseek-v4-pro",
    thinking_level: "medium",
    summary_title: "Added an explicit planning step",
    summary:
      "Example data (not a real evaluation): after adding an explicit planning step to the " +
      "system prompt (hypothesis: written plans reduce missed requirements), both cases " +
      "improved. Next: tighten output formatting.",
    cases: [
      {
        case: "CASE-001-file-summary",
        runs: [
          {
            score: 70,
            cost: 0.011,
            duration_ms: 39000,
            session_id: "session-2026-07-15-09-04-33-2b3c4d01",
          },
          {
            score: 80,
            cost: 0.013,
            duration_ms: 45000,
            session_id: "session-2026-07-15-09-12-08-2b3c4d02",
          },
        ],
      },
      {
        case: "CASE-002-data-cleanup",
        runs: [
          {
            score: 70,
            cost: 0.016,
            duration_ms: 60000,
            session_id: "session-2026-07-15-09-19-40-2b3c4d03",
          },
          {
            score: 80,
            cost: 0.02,
            duration_ms: 68000,
            session_id: "session-2026-07-15-09-26-59-2b3c4d04",
          },
        ],
      },
    ],
  },
  {
    time: "2026-07-16T09:30:00Z",
    version: 3,
    provider: "deepseek",
    model_id: "deepseek-v4-pro",
    thinking_level: "medium",
    summary_title: "Verify deliverables before finishing",
    summary:
      "Example data (not a real evaluation): after instructing the agent to verify its " +
      "deliverables against the statement before finishing (hypothesis: a final check " +
      "catches formatting slips), scores improved again. Replace this benchmark with your " +
      "own to track real progress.",
    cases: [
      {
        case: "CASE-001-file-summary",
        runs: [
          {
            score: 80,
            cost: 0.01,
            duration_ms: 36000,
            session_id: "session-2026-07-16-09-03-21-3c4d5e01",
          },
          {
            score: 90,
            cost: 0.012,
            duration_ms: 40000,
            session_id: "session-2026-07-16-09-10-46-3c4d5e02",
          },
        ],
      },
      {
        case: "CASE-002-data-cleanup",
        runs: [
          {
            score: 90,
            cost: 0.015,
            duration_ms: 55000,
            session_id: "session-2026-07-16-09-18-02-3c4d5e03",
          },
          {
            score: 80,
            cost: 0.017,
            duration_ms: 61000,
            session_id: "session-2026-07-16-09-25-30-3c4d5e04",
          },
        ],
      },
    ],
  },
];

function roundTwo(v: number): number {
  return Math.round(v * 100) / 100;
}

function averageTwo(values: number[]): number {
  return roundTwo(values.reduce((a, b) => a + b, 0) / values.length);
}

function averageSix(values: number[]): number {
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1_000_000) / 1_000_000;
}

function averageDuration(values: number[]): number {
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function averageKnownCost(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? averageSix(known) : null;
}

/**
 * Builds the example Scoreboard exactly as the model is instructed to write it. This helper
 * exists only to provision deterministic sample data; runtime readers trust the stored values
 * and never call it to recompute a user Scoreboard.
 */
export function buildExampleScoreboard(): {
  evaluations: Array<{
    time: string;
    version: number;
    provider: string;
    model_id: string;
    thinking_level: string;
    summary_title: string;
    summary: string;
    score: number;
    cost: number | null;
    duration_ms: number;
    provenance: Record<string, unknown>;
    cases: Array<{
      case: string;
      score: number;
      cost: number | null;
      duration_ms: number;
      runs: ExampleRun[];
    }>;
  }>;
} {
  return {
    evaluations: EXAMPLE_EVALUATIONS.map((e) => {
      const cases = e.cases.map((c) => ({
        case: c.case,
        score: averageTwo(c.runs.map((r) => r.score)),
        cost: averageKnownCost(c.runs.map((r) => r.cost)),
        duration_ms: averageDuration(c.runs.map((r) => r.duration_ms)),
        runs: c.runs,
      }));
      return {
        time: e.time,
        version: e.version,
        provider: e.provider,
        model_id: e.model_id,
        thinking_level: e.thinking_level,
        summary_title: e.summary_title,
        summary: e.summary,
        score: averageTwo(cases.map((c) => c.score)),
        cost: averageKnownCost(cases.map((c) => c.cost)),
        duration_ms: averageDuration(cases.map((c) => c.duration_ms)),
        provenance: exampleProvenance(e.version),
        cases,
      };
    }),
  };
}

/**
 * Provisions the example Benchmark: if `benchmarks/` already exists (the user already has a
 * case library), does nothing; otherwise creates `benchmarks/example-benchmark/` (config, the
 * two sample cases, and the scoreboard). Callers are restricted to the default_agent
 * initialization path (see agent-state.ts).
 */
export async function provisionExampleBenchmark(
  root: string,
  projectId: string,
  agentId: string,
): Promise<void> {
  const dir = benchmarksDir(root, projectId, agentId);
  try {
    await fs.access(dir);
    return;
  } catch {
    // benchmarks/ does not exist: proceed with provisioning.
  }
  const benchDir = path.join(dir, EXAMPLE_BENCHMARK_ID);
  await Promise.all(
    EXAMPLE_CASES.flatMap((c) => [
      fs.mkdir(path.join(benchDir, c.id, "statement"), { recursive: true }),
      fs.mkdir(path.join(benchDir, c.id, "rubric"), { recursive: true }),
    ]),
  );
  await Promise.all([
    fs.writeFile(
      path.join(benchDir, "benchmark_config.toml"),
      `${stringifyToml(EXAMPLE_BENCHMARK_CONFIG)}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(benchDir, "scoreboard.yaml"),
      stringifyYaml(buildExampleScoreboard()),
      "utf8",
    ),
    ...EXAMPLE_CASES.flatMap((c) => [
      fs.writeFile(path.join(benchDir, c.id, "statement", "README.md"), c.statement, "utf8"),
      fs.writeFile(path.join(benchDir, c.id, "rubric", "README.md"), c.rubric, "utf8"),
    ]),
  ]);
}
