/**
 * Promotion-gated self-evolution E2E.
 *
 * This runs two disposable real-model scenarios:
 *   1. a Development-authored general Candidate that passes a held-out Promotion task;
 *   2. a deliberately overfit Development Candidate that is rejected and restored from v1.
 *
 * The Promotion evidence is never shown to either optimization Session. Each Candidate is
 * snapshotted before its held-out run, and every run writes a small audit report beside the
 * disposable Agent State.
 *
 * Run: pnpm --dir examples/self-improving-agent promotion:e2e
 */
import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  createAgent,
  isCompleteModelMessage,
  userText,
  type OmniMessage,
} from "@prismshadow/penguin-core";

const execFile = promisify(execFileCallback);
const PROJECT_ID = "default_project";
const RUN_ID = (process.env.PROMOTION_E2E_RUN_ID ?? new Date().toISOString())
  .replace(/[^0-9A-Za-z]+/g, "-")
  .replace(/^-|-$/g, "")
  .toLowerCase();
const SCENARIO = process.env.PROMOTION_E2E_SCENARIO ?? "all";
const CONVENTION_NONCE = randomBytes(6).toString("hex");

const CONVENTION = {
  marker: `<!-- PROMOTION-${CONVENTION_NONCE} -->`,
  classification: "Classification: INTERNAL",
  footer: `Reviewed-by: Gate-${CONVENTION_NONCE}`,
};

interface ReportCase {
  id: string;
  subject: string;
  notes: string;
  facts: string[];
}

interface Evaluation {
  caseId: string;
  version: number;
  score: number;
  sessionId: string;
  durationMs: number;
  report: string | null;
  provider: string;
  modelId: string;
  thinkingLevel: string;
}

interface EvaluationMetadata {
  evaluationKind: "formal_baseline" | "development_candidate" | "promotion_candidate";
  optimizationSessionId?: string;
  productionReferenceVersion?: number;
  promotionDecision?: "promoted" | "restored";
}

interface ScenarioOutcome {
  agentId: string;
  optimizationSessionId: string;
  baselineDevelopment: Evaluation;
  baselinePromotion: Evaluation;
  candidateDevelopment: Evaluation;
  candidatePromotion: Evaluation;
  decision: "promote" | "restore";
  finalVersion: number;
  candidateSnapshot: string;
  optimizationTraceClean: boolean;
}

const DEVELOPMENT: ReportCase = {
  id: "CASE-001-aurora-report",
  subject: "Project Aurora",
  notes: `Project Aurora — Internal Notes
Report class: STREAM

Aurora is a real-time analytics platform launched in Q1 2026. It ingests 2 million events per
second. A Rust rewrite reduced p99 latency from 800ms to 120ms. Reducing hot retention from 90
days to 30 days would lower storage cost by 55%.`,
  facts: ["2 million", "120ms", "55%"],
};

const PROMOTION: ReportCase = {
  id: "CASE-001-borealis-report",
  subject: "Project Borealis",
  notes: `Project Borealis — Internal Notes
Report class: BATCH

Borealis is a batch analytics platform launched in Q2 2026. It processes 40 TB each night. A
Spark migration reduced the nightly window from 6 hours to 90 minutes. Its autoscaling fleet has
200 workers.`,
  facts: ["40 TB", "90 minutes", "200 workers"],
};

const ACCEPTED_DEVELOPMENT_EXAMPLES = `${CONVENTION.marker}
# Report: Project Helios
${CONVENTION.classification}

Helios is an internal streaming platform.

- Handles 900,000 records per second
- Reduced p95 latency to 80ms
- Keeps 45 days of hot data

${CONVENTION.footer}

--- accepted report 2 ---

${CONVENTION.marker}
# Report: Project Cinder
${CONVENTION.classification}

Cinder is an internal query platform.

- Handles 700,000 queries per minute
- Keeps p95 latency below 60ms
- Retains 30 days of hot data

${CONVENTION.footer}

--- accepted report 3 ---

${CONVENTION.marker}
# Report: Project Delta
${CONVENTION.classification}

Delta is an internal storage platform.

- Stores 12 PB of compressed data
- Completes compaction in 40 minutes
- Runs across 160 workers

${CONVENTION.footer}
`;

function rootDir(): string {
  return process.env.PENGUIN_HOME ?? path.join(os.homedir(), ".penguin", "data");
}

function projectDir(): string {
  return path.join(rootDir(), PROJECT_ID);
}

function agentDir(agentId: string): string {
  return path.join(projectDir(), "agents", agentId);
}

function stateDir(agentId: string): string {
  return path.join(agentDir(agentId), "agent_state");
}

function assertDisposable(agentId: string): void {
  if (!agentId.startsWith("promotion-e2e-")) {
    throw new Error(`Refusing to mutate non-disposable Agent: ${agentId}`);
  }
  const resolved = path.resolve(agentDir(agentId));
  const agentsRoot = `${path.resolve(projectDir(), "agents")}${path.sep}`;
  if (!resolved.startsWith(agentsRoot)) {
    throw new Error(`Disposable Agent escaped the Project: ${resolved}`);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collect(run: AsyncGenerator<OmniMessage>): Promise<void> {
  for await (const message of run) {
    if (isCompleteModelMessage(message) && message.payload.type === "text") {
      // The durable files and Trace are the E2E evidence; keep console output compact.
    }
  }
}

async function readVersion(agentId: string): Promise<number> {
  const config = await fs.readFile(path.join(stateDir(agentId), "system_config.yaml"), "utf8");
  const match = config.match(/^version:\s*(\d+)\s*$/m);
  if (!match) throw new Error(`Missing Agent State version for ${agentId}`);
  return Number(match[1]);
}

async function writeVersion(agentId: string, version: number): Promise<void> {
  const configPath = path.join(stateDir(agentId), "system_config.yaml");
  const config = await fs.readFile(configPath, "utf8");
  if (!/^version:\s*\d+\s*$/m.test(config)) {
    throw new Error(`Missing Agent State version for ${agentId}`);
  }
  await fs.writeFile(configPath, config.replace(/^version:\s*\d+\s*$/m, `version: ${version}`));
}

async function readThinkingLevel(agentId: string): Promise<string> {
  const config = await fs.readFile(path.join(stateDir(agentId), "system_config.yaml"), "utf8");
  return config.match(/^\s*thinking_level:\s*(\S+)\s*$/m)?.[1] ?? "medium";
}

async function snapshot(agentId: string, version: number): Promise<string> {
  assertDisposable(agentId);
  if ((await readVersion(agentId)) !== version) {
    throw new Error(`Cannot snapshot ${agentId}: active version is not v${version}`);
  }
  const snapshots = path.join(agentDir(agentId), "snapshots");
  const archive = path.join(snapshots, `v${version}.tar.gz`);
  if (await exists(archive)) {
    throw new Error(`Refusing to overwrite Snapshot: ${archive}`);
  }
  await fs.mkdir(snapshots, { recursive: true });
  const temporary = `${archive}.tmp-${process.pid}`;
  await execFile("tar", ["-czf", temporary, "--exclude=.vault.toml", "-C", stateDir(agentId), "."]);
  await fs.rename(temporary, archive);
  await verifySnapshot(archive, version);
  return archive;
}

async function extractSnapshot(archive: string): Promise<string> {
  const extracted = await fs.mkdtemp(path.join(os.tmpdir(), "promotion-snapshot-"));
  await execFile("tar", ["-xzf", archive, "-C", extracted]);
  return extracted;
}

async function verifySnapshot(archive: string, version: number): Promise<void> {
  const extracted = await extractSnapshot(archive);
  try {
    const config = await fs.readFile(path.join(extracted, "system_config.yaml"), "utf8");
    const match = config.match(/^version:\s*(\d+)\s*$/m);
    if (Number(match?.[1]) !== version) {
      throw new Error(`Snapshot ${archive} does not contain v${version}`);
    }
  } finally {
    await fs.rm(extracted, { recursive: true, force: true });
  }
}

async function restore(agentId: string, archive: string, version: number): Promise<void> {
  assertDisposable(agentId);
  await verifySnapshot(archive, version);
  const extracted = await extractSnapshot(archive);
  const active = stateDir(agentId);
  const backup = `${active}.rollback-${process.pid}`;
  await fs.rename(active, backup);
  try {
    await fs.rename(extracted, active);
    if ((await readVersion(agentId)) !== version) {
      throw new Error(`Restored Agent State did not verify as v${version}`);
    }
    await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (await exists(active)) await fs.rm(active, { recursive: true, force: true });
    await fs.rename(backup, active);
    throw error;
  } finally {
    if (await exists(extracted)) await fs.rm(extracted, { recursive: true, force: true });
  }
}

function score(report: string | null, testCase: ReportCase): number {
  if (report === null) return 0;
  let points = 5; // summary.md exists
  if (report.includes(testCase.subject)) points += 10;
  for (const fact of testCase.facts) {
    if (report.toLowerCase().includes(fact.toLowerCase())) points += 15;
  }
  const lines = report.split("\n");
  if (lines[0]?.trim() === CONVENTION.marker) points += 10;
  if (lines[1]?.trim() === `# Report: ${testCase.subject}`) points += 10;
  if (report.includes(CONVENTION.classification)) points += 5;
  const last = [...lines]
    .reverse()
    .find((line) => line.trim() !== "")
    ?.trim();
  if (last === CONVENTION.footer) points += 10;
  if (
    lines[0]?.trim() === CONVENTION.marker &&
    lines[1]?.trim() === `# Report: ${testCase.subject}` &&
    report.includes(CONVENTION.classification) &&
    last === CONVENTION.footer
  ) {
    points += 5;
  }
  return points;
}

async function evaluate(
  agentId: string,
  phase: "development" | "promotion",
  testCase: ReportCase,
): Promise<Evaluation> {
  const beforeVersion = await readVersion(agentId);
  const beforeThinkingLevel = await readThinkingLevel(agentId);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `promotion-${phase}-`));
  await fs.writeFile(path.join(workspace, "notes.txt"), testCase.notes, "utf8");
  const agent = await createAgent({ agentId, projectId: PROJECT_ID });
  const session = await agent.createSession({ workspaceDir: workspace });
  const started = Date.now();
  await collect(
    session.run(
      [
        userText(
          "Read notes.txt and write summary.md with a short overview and exactly three bullet facts. Follow the team's standard report format. Do not modify Agent State.",
        ),
      ],
      { approve: async () => "allow" },
    ),
  );
  const durationMs = Date.now() - started;
  if (!(await auditEvaluationTrace(agentId, session.sessionId))) {
    throw new Error(
      `${phase} evaluation ${session.sessionId} accessed data outside its isolated Workspace`,
    );
  }
  const afterVersion = await readVersion(agentId);
  const afterThinkingLevel = await readThinkingLevel(agentId);
  if (beforeVersion !== afterVersion || beforeThinkingLevel !== afterThinkingLevel) {
    throw new Error(
      `${phase} evaluation changed Agent State v${beforeVersion}/${beforeThinkingLevel} -> v${afterVersion}/${afterThinkingLevel}`,
    );
  }
  let report: string | null = null;
  try {
    report = await fs.readFile(path.join(workspace, "summary.md"), "utf8");
  } catch {
    report = null;
  }
  const result = {
    caseId: testCase.id,
    version: beforeVersion,
    score: score(report, testCase),
    sessionId: session.sessionId,
    durationMs,
    report,
    provider: session.provider,
    modelId: session.modelId,
    thinkingLevel: beforeThinkingLevel,
  };
  const evidenceDir = path.join(agentDir(agentId), "promotion-e2e", phase);
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, `v${beforeVersion}-${testCase.id}.md`),
    report ?? "(summary.md was not produced)\n",
  );
  await fs.rm(workspace, { recursive: true, force: true });
  return result;
}

async function runOptimization(agentId: string, prompt: string): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "promotion-optimize-"));
  const agent = await createAgent({ agentId, projectId: PROJECT_ID });
  const session = await agent.createSession({ workspaceDir: workspace });
  await collect(session.run([userText(prompt)], { approve: async () => "allow" }));
  await fs.rm(workspace, { recursive: true, force: true });
  const agentsMd = await fs.readFile(path.join(stateDir(agentId), "AGENTS.md"), "utf8");
  if (agentsMd.trim() === "")
    throw new Error(`Optimization ${session.sessionId} wrote no guidance`);
  return session.sessionId;
}

async function auditOptimizationTrace(agentId: string, sessionId: string): Promise<boolean> {
  const toolCalls = await sessionToolCallArguments(agentId, sessionId);
  return toolCalls.every(
    (argumentsText) =>
      !argumentsText.includes("CASE-001-borealis-report") &&
      !argumentsText.includes("/benchmarks/") &&
      !argumentsText.includes("/rubric/") &&
      !argumentsText.includes("/traces/"),
  );
}

async function sessionToolCallArguments(agentId: string, sessionId: string): Promise<string[]> {
  const traces = path.join(agentDir(agentId), "traces");
  const days = await fs.readdir(traces);
  const candidates: string[] = [];
  for (const day of days) {
    const dayDir = path.join(traces, day);
    for (const name of await fs.readdir(dayDir)) {
      if (name.startsWith(`${sessionId}_`) && name.endsWith(".jsonl")) {
        candidates.push(path.join(dayDir, name));
      }
    }
  }
  if (candidates.length === 0) throw new Error(`Trace not found for ${sessionId}`);
  const calls: string[] = [];
  for (const file of candidates) {
    const lines = (await fs.readFile(file, "utf8")).split("\n");
    for (const line of lines) {
      if (line.trim() === "") continue;
      const event = JSON.parse(line) as {
        type?: string;
        payload?: { type?: string; arguments?: string };
      };
      if (event.type === "model_msg" && event.payload?.type === "tool_call") {
        calls.push(event.payload.arguments ?? "");
      }
    }
  }
  return calls;
}

async function auditEvaluationTrace(agentId: string, sessionId: string): Promise<boolean> {
  const toolCalls = await sessionToolCallArguments(agentId, sessionId);
  const forbiddenRoots = [projectDir(), os.homedir()];
  return toolCalls.every(
    (argumentsText) =>
      !argumentsText.includes("/benchmarks/") &&
      !argumentsText.includes("/rubric/") &&
      !argumentsText.includes("/traces/") &&
      !forbiddenRoots.some((root) => argumentsText.includes(root)) &&
      !argumentsText.includes("$HOME") &&
      !argumentsText.includes("~/"),
  );
}

async function initializeBenchmark(
  agentId: string,
  benchmarkId: "development" | "promotion",
  testCase: ReportCase,
): Promise<void> {
  const benchmark = path.join(agentDir(agentId), "benchmarks", benchmarkId);
  const caseRoot = path.join(benchmark, testCase.id);
  await fs.mkdir(path.join(caseRoot, "statement"), { recursive: true });
  await fs.mkdir(path.join(caseRoot, "rubric"), { recursive: true });
  await fs.writeFile(
    path.join(benchmark, "benchmark_config.toml"),
    `title = "Promotion E2E ${benchmarkId}"\ndescription = "Disposable report-format transfer Benchmark"\nrole = "${benchmarkId}"\npaired_benchmark_id = "${benchmarkId === "development" ? "promotion" : "development"}"\nruns = 1\n`,
  );
  await fs.writeFile(
    path.join(caseRoot, "statement", "README.md"),
    `# ${testCase.subject} report\n\nRead notes.txt and write summary.md with a short overview and exactly three bullet facts. Follow the team's standard report format.\n\n## notes.txt\n\n${testCase.notes}\n`,
  );
  await fs.writeFile(
    path.join(caseRoot, "rubric", "README.md"),
    `# Private rubric (max 100 points)\n\n- Artifact exists: 5 pts\n- Correct subject (${testCase.subject}): 10 pts\n- Three required facts (${testCase.facts.join(", ")}): 45 pts\n- Exact marker (${CONVENTION.marker}): 10 pts\n- Exact subject title (# Report: ${testCase.subject}): 10 pts\n- Classification (${CONVENTION.classification}): 5 pts\n- Footer (${CONVENTION.footer}): 10 pts\n- Complete convention: 5 pts\n`,
  );
  await fs.writeFile(path.join(benchmark, "scoreboard.yaml"), '{"evaluations":[]}\n');
}

async function appendEvaluation(
  agentId: string,
  benchmarkId: "development" | "promotion",
  evaluation: Evaluation,
  summary: string,
  metadata: EvaluationMetadata,
): Promise<void> {
  const scoreboardPath = path.join(agentDir(agentId), "benchmarks", benchmarkId, "scoreboard.yaml");
  const parsed = JSON.parse(await fs.readFile(scoreboardPath, "utf8")) as {
    evaluations?: unknown[];
  };
  const evaluations = Array.isArray(parsed.evaluations) ? parsed.evaluations : [];
  evaluations.push({
    time: new Date().toISOString(),
    version: evaluation.version,
    provider: evaluation.provider,
    model_id: evaluation.modelId,
    thinking_level: evaluation.thinkingLevel,
    evaluation_kind: metadata.evaluationKind,
    ...(metadata.optimizationSessionId
      ? { optimization_session_id: metadata.optimizationSessionId }
      : {}),
    ...(metadata.productionReferenceVersion
      ? { production_reference_version: metadata.productionReferenceVersion }
      : {}),
    ...(metadata.promotionDecision ? { promotion_decision: metadata.promotionDecision } : {}),
    summary_title: `promotion-e2e ${evaluation.caseId}`,
    summary,
    score: evaluation.score,
    cost: null,
    duration_ms: evaluation.durationMs,
    cases: [
      {
        case: evaluation.caseId,
        score: evaluation.score,
        cost: null,
        duration_ms: evaluation.durationMs,
        runs: [
          {
            score: evaluation.score,
            cost: null,
            duration_ms: evaluation.durationMs,
            session_id: evaluation.sessionId,
          },
        ],
      },
    ],
  });
  await fs.writeFile(scoreboardPath, `${JSON.stringify({ evaluations }, null, 2)}\n`, "utf8");
  const verified = JSON.parse(await fs.readFile(scoreboardPath, "utf8")) as {
    evaluations?: Array<{
      version?: number;
      score?: number;
      evaluation_kind?: string;
      optimization_session_id?: string;
      production_reference_version?: number;
      promotion_decision?: string;
      cases?: Array<{ runs?: unknown[] }>;
    }>;
  };
  const stored = verified.evaluations?.at(-1);
  if (
    stored?.version !== evaluation.version ||
    stored.score !== evaluation.score ||
    stored.evaluation_kind !== metadata.evaluationKind ||
    stored.optimization_session_id !== metadata.optimizationSessionId ||
    stored.production_reference_version !== metadata.productionReferenceVersion ||
    stored.promotion_decision !== metadata.promotionDecision ||
    stored.cases?.[0]?.runs?.length !== 1
  ) {
    throw new Error(`Scoreboard verification failed: ${scoreboardPath}`);
  }
}

async function writeAudit(agentId: string, outcome: ScenarioOutcome): Promise<void> {
  await fs.writeFile(
    path.join(agentDir(agentId), "promotion-e2e", "audit.json"),
    `${JSON.stringify(outcome, null, 2)}\n`,
  );
}

async function initialize(agentId: string, baselineGuidance = ""): Promise<void> {
  assertDisposable(agentId);
  if (await exists(agentDir(agentId))) {
    throw new Error(
      `Disposable Agent already exists; choose another PROMOTION_E2E_RUN_ID: ${agentId}`,
    );
  }
  await createAgent({ agentId, projectId: PROJECT_ID });
  await fs.writeFile(
    path.join(stateDir(agentId), "AGENTS.md"),
    `For ordinary tasks, read and write only inside the current Workspace (CWD). Never inspect the App Data Dir, Benchmarks, rubrics, Traces, other Agents, or files outside CWD. When a requested house convention is not provided in CWD or these instructions, do the task normally without searching for it elsewhere.\n${baselineGuidance}`,
    "utf8",
  );
  await initializeBenchmark(agentId, "development", DEVELOPMENT);
  await initializeBenchmark(agentId, "promotion", PROMOTION);
  if ((await readVersion(agentId)) !== 1) throw new Error(`${agentId} did not initialize at v1`);
}

async function runPassScenario(): Promise<ScenarioOutcome> {
  const agentId = `promotion-e2e-pass-${RUN_ID}`;
  await initialize(agentId);
  const baselineDevelopment = await evaluate(agentId, "development", DEVELOPMENT);
  const baselinePromotion = await evaluate(agentId, "promotion", PROMOTION);
  await appendEvaluation(agentId, "development", baselineDevelopment, "Formal Baseline", {
    evaluationKind: "formal_baseline",
  });
  await appendEvaluation(agentId, "promotion", baselinePromotion, "Formal Baseline", {
    evaluationKind: "formal_baseline",
  });
  const productionSnapshot = await snapshot(agentId, 1);
  await writeVersion(agentId, 2);

  const failedReport = baselineDevelopment.report ?? "(missing report)";
  const optimizationSessionId = await runOptimization(
    agentId,
    `You are improving your own future report-writing behavior using Development evidence only.

Your rejected Development report was:
---
${failedReport}
---

Three reports for different projects that passed Development review were:
---
${ACCEPTED_DEVELOPMENT_EXAMPLES}
---

Compare all three accepted reports and treat every token that remains identical across them as a
fixed literal, not a placeholder or value derived from the Agent id. Infer the reusable report
convention and write concise durable instructions into your own AGENTS.md at ${path.join(stateDir(agentId), "AGENTS.md")}.
Preserve the exact fixed constants while making the report subject and facts vary with each task.
Also preserve the rule that ordinary task runs may access only their current Workspace. Do not
inspect any Benchmark, rubric, or Trace.`,
  );
  const optimizationTraceClean = await auditOptimizationTrace(agentId, optimizationSessionId);
  if (!optimizationTraceClean)
    throw new Error("Pass optimization Trace contains held-out evidence");
  const candidateDevelopment = await evaluate(agentId, "development", DEVELOPMENT);
  if (candidateDevelopment.score <= baselineDevelopment.score) {
    await restore(agentId, productionSnapshot, 1);
    throw new Error(
      `Pass Candidate did not improve Development: ${baselineDevelopment.score} -> ${candidateDevelopment.score}`,
    );
  }
  await appendEvaluation(
    agentId,
    "development",
    candidateDevelopment,
    `optimization_session_id=${optimizationSessionId}; accepted Candidate`,
    {
      evaluationKind: "development_candidate",
      optimizationSessionId,
      productionReferenceVersion: 1,
    },
  );
  const candidateSnapshot = await snapshot(agentId, 2);
  const candidatePromotion = await evaluate(agentId, "promotion", PROMOTION);
  const decision = candidatePromotion.score >= baselinePromotion.score ? "promote" : "restore";
  await appendEvaluation(
    agentId,
    "promotion",
    candidatePromotion,
    `optimization_session_id=${optimizationSessionId}; promotion Candidate`,
    {
      evaluationKind: "promotion_candidate",
      optimizationSessionId,
      productionReferenceVersion: 1,
      promotionDecision: decision === "promote" ? "promoted" : "restored",
    },
  );
  if (decision === "restore") await restore(agentId, productionSnapshot, 1);
  const finalVersion = await readVersion(agentId);
  const outcome: ScenarioOutcome = {
    agentId,
    optimizationSessionId,
    baselineDevelopment,
    baselinePromotion,
    candidateDevelopment,
    candidatePromotion,
    decision,
    finalVersion,
    candidateSnapshot,
    optimizationTraceClean,
  };
  await writeAudit(agentId, outcome);
  if (decision !== "promote" || finalVersion !== 2) {
    throw new Error(`Expected pass scenario to retain v2, got ${decision} at v${finalVersion}`);
  }
  return outcome;
}

async function runFailScenario(): Promise<ScenarioOutcome> {
  const agentId = `promotion-e2e-fail-${RUN_ID}`;
  await initialize(
    agentId,
    `\nOnly when notes contain the exact line "Report class: BATCH", use this production format while preserving the current subject and facts. Never apply it to STREAM or any other class:\n\n${CONVENTION.marker}\n# Report: <current task subject>\n${CONVENTION.classification}\n\n<one-sentence overview>\n\n- <fact 1 from the current notes>\n- <fact 2 from the current notes>\n- <fact 3 from the current notes>\n\n${CONVENTION.footer}\n`,
  );
  const baselineDevelopment = await evaluate(agentId, "development", DEVELOPMENT);
  const baselinePromotion = await evaluate(agentId, "promotion", PROMOTION);
  await appendEvaluation(agentId, "development", baselineDevelopment, "Formal Baseline", {
    evaluationKind: "formal_baseline",
  });
  await appendEvaluation(agentId, "promotion", baselinePromotion, "Formal Baseline", {
    evaluationKind: "formal_baseline",
  });
  const productionSnapshot = await snapshot(agentId, 1);
  await writeVersion(agentId, 2);

  const optimizationSessionId = await runOptimization(
    agentId,
    `This is a negative-control optimization using Development evidence only. Create a narrow
Candidate based on the approved metrics observed in Development so the promotion gate can test
whether that policy transfers.

Overwrite your own AGENTS.md at ${path.join(stateDir(agentId), "AGENTS.md")} with a strict internal
report policy. Read the current task's subject, but every report must use the exact format below
and exactly these three approved metric bullets; do not publish any other metric type even when
the task notes contain one. The overview may identify the current subject and platform type, but
must contain no digits, quantities, performance values, or other metrics from the task notes.

This optimization Workspace is intentionally empty. Do not resolve or test the subject now and do
not search for any task instance. Write the text <current task subject> as a literal placeholder in
AGENTS.md; ordinary future task runs will replace it from files in their own Workspace. Replace the
old batch-only report rule rather than carrying it forward: this negative control intentionally
tests whether Development improvement forgets a production capability slice.

${CONVENTION.marker}
# Report: <current task subject>
${CONVENTION.classification}

<one-sentence overview of the current task subject>

- Approved event rate: 2 million events per second
- Approved p99 latency: 120ms
- Approved storage reduction: 55%

${CONVENTION.footer}

Also preserve a rule that ordinary task runs may read and write only inside their current
Workspace. Do not inspect any Benchmark, rubric, Trace, or other Agent.`,
  );
  const optimizationTraceClean = await auditOptimizationTrace(agentId, optimizationSessionId);
  if (!optimizationTraceClean)
    throw new Error("Fail optimization Trace contains held-out evidence");
  const candidateDevelopment = await evaluate(agentId, "development", DEVELOPMENT);
  if (candidateDevelopment.score <= baselineDevelopment.score) {
    await restore(agentId, productionSnapshot, 1);
    throw new Error(
      `Negative-control Candidate did not improve Development: ${baselineDevelopment.score} -> ${candidateDevelopment.score}`,
    );
  }
  await appendEvaluation(
    agentId,
    "development",
    candidateDevelopment,
    `optimization_session_id=${optimizationSessionId}; accepted Candidate`,
    {
      evaluationKind: "development_candidate",
      optimizationSessionId,
      productionReferenceVersion: 1,
    },
  );
  const candidateSnapshot = await snapshot(agentId, 2);
  const candidatePromotion = await evaluate(agentId, "promotion", PROMOTION);
  const decision = candidatePromotion.score >= baselinePromotion.score ? "promote" : "restore";
  await appendEvaluation(
    agentId,
    "promotion",
    candidatePromotion,
    `optimization_session_id=${optimizationSessionId}; promotion Candidate`,
    {
      evaluationKind: "promotion_candidate",
      optimizationSessionId,
      productionReferenceVersion: 1,
      promotionDecision: decision === "promote" ? "promoted" : "restored",
    },
  );
  if (decision === "restore") await restore(agentId, productionSnapshot, 1);
  const finalVersion = await readVersion(agentId);
  const outcome: ScenarioOutcome = {
    agentId,
    optimizationSessionId,
    baselineDevelopment,
    baselinePromotion,
    candidateDevelopment,
    candidatePromotion,
    decision,
    finalVersion,
    candidateSnapshot,
    optimizationTraceClean,
  };
  await writeAudit(agentId, outcome);
  if (decision !== "restore" || finalVersion !== 1) {
    throw new Error(`Expected fail scenario to restore v1, got ${decision} at v${finalVersion}`);
  }
  await verifySnapshot(candidateSnapshot, 2);
  return outcome;
}

function printOutcome(label: string, outcome: ScenarioOutcome): void {
  console.log(`\n=== ${label} ===`);
  console.log(`Agent: ${outcome.agentId}`);
  console.log(
    `Development: v1 ${outcome.baselineDevelopment.score} -> v2 ${outcome.candidateDevelopment.score}`,
  );
  console.log(
    `Promotion:   v1 ${outcome.baselinePromotion.score} -> v2 ${outcome.candidatePromotion.score}`,
  );
  console.log(`Decision: ${outcome.decision}; final active version: v${outcome.finalVersion}`);
  console.log(`Candidate Snapshot: ${outcome.candidateSnapshot}`);
  console.log(`Optimizer held-out/rubric Trace audit: clean`);
}

async function main(): Promise<void> {
  if (!new Set(["all", "pass", "fail"]).has(SCENARIO)) {
    throw new Error(`PROMOTION_E2E_SCENARIO must be all, pass, or fail; got ${SCENARIO}`);
  }
  if (SCENARIO !== "fail") {
    const passed = await runPassScenario();
    printOutcome("GENERAL CANDIDATE", passed);
  }
  if (SCENARIO !== "pass") {
    const failed = await runFailScenario();
    printOutcome("OVERFIT NEGATIVE CONTROL", failed);
  }
  console.log(`\nPromotion-gated self-evolution E2E passed: ${SCENARIO}.`);
}

main().catch((error) => {
  console.error("Promotion E2E failed:", error);
  process.exitCode = 1;
});
