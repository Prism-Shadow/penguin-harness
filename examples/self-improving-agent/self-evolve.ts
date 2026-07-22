/**
 * GENUINE self-evolution demo — the agent diagnoses its own failure and edits its OWN AGENTS.md.
 *
 * The original example (and the -hard variant) hardcode the improvement:
 *   `fs.writeFile(agentsMd, DISCIPLINE)`  ← the human writes the answer, the agent just benefits.
 * That demonstrates the *scoring loop*, but NOT self-evolution — the model does no diagnosing and
 * authors no fix.
 *
 * Here the EDIT step is done BY THE AGENT ITSELF:
 *   1. EVALUATE   — the agent writes a report for a task that says only "follow your team's format".
 *                   With a blank AGENTS.md it cannot know the (arbitrary, unguessable) house
 *                   convention, so it stably loses the convention points.
 *   2. REFLECT    — the agent is shown (a) its own rejected report and (b) a DIFFERENT report that
 *                   passed review. Nobody tells it the rules. It must compare the two, INFER the
 *                   reusable convention, and write that convention into its OWN AGENTS.md.
 *   3. RE-EVALUATE — the same task again; now the agent applies the rule it taught itself.
 *   4. KEEP / ROLL BACK — keep the self-authored AGENTS.md only if the mean score improved.
 *
 * The script never writes the convention. It only supplies a failure signal + one worked example;
 * the model does the diagnosis and persists its own improvement into its identity (AGENTS.md).
 * The reference uses a DIFFERENT subject (Borealis) than the task (Aurora), so the agent must
 * generalize the *rules*, not copy the *content*.
 *
 * Run:  cd examples/self-improving-agent && pnpm exec tsx self-evolve.ts
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAgent,
  userText,
  isCompleteModelMessage,
  type OmniMessage,
} from "@prismshadow/penguin-core";

const AGENT_ID = "self-improve-demo";
const PROJECT_ID = "default_project";

/** The task fully specifies content, but only says "follow your team's format" — the convention
 *  itself is knowable only from AGENTS.md, which the agent must author for itself in REFLECT. */
const TASK = `Read notes.txt in your workspace and write summary.md that summarizes the notes with:
(1) an overview of at most 2 sentences, and
(2) a bullet list of exactly 3 key facts.
Follow your team's standard report format.`;

const NOTES = `Project Aurora — Internal Notes

Aurora is a real-time analytics platform launched in Q1 2026. At peak it ingests roughly
2 million events per second through a Kafka-based pipeline. The core query engine was rewritten
in Rust after the original Go version could not keep p99 latency under control; the rewrite cut
p99 from 800ms to 120ms.

The production deployment is single-region with no failover; a multi-region rollout is scheduled
for Q3 2026. Storage is the largest cost line at about $48,000/month, driven by a 90-day
hot-retention policy; cutting retention to 30 days would reduce storage cost by roughly 55%.
`;

/** A gold report that PASSED review — a DIFFERENT subject (Borealis), so the agent must infer the
 *  reusable rules (marker/title-pattern/metadata/footer) rather than copy this report's content. */
const REFERENCE_REPORT = `<!-- ACME-DATA-PLATFORM -->
# Report: Project Borealis
Classification: INTERNAL

Borealis is a batch ETL platform migrated to Spark in 2025; it processes about 40TB nightly.

- Cut the nightly window from 6h to 90 minutes
- Runs on a 200-node autoscaling cluster
- Compute costs roughly $12,000/month

Reviewed-by: Aurora Team
`;

function rootDir(): string {
  return process.env.PENGUIN_HOME ?? path.join(os.homedir(), ".penguin", "data");
}
function agentStateDir(): string {
  return path.join(rootDir(), PROJECT_ID, "agents", AGENT_ID, "agent_state");
}

/** 10 atomic points: 5 CONTENT (inferable from the task) + 5 CONVENTION (knowable only from the
 *  house rule the agent must teach itself). Line-2 check requires the ACTUAL subject (Aurora),
 *  so blindly copying the Borealis reference does not earn the point. */
function score(summaryText: string | null): { score: number; detail: string[] } {
  const detail: string[] = [];
  let s = 0;
  const add = (ok: boolean, label: string) => {
    if (ok) s += 1;
    detail.push(`${ok ? "1" : "0"}/1  ${label}`);
  };

  const exists = summaryText !== null;
  add(exists, "file summary.md was written");
  if (!exists) return { score: 0, detail };
  const text = summaryText!;
  const lines = text.split("\n");

  // CONTENT points
  const bullets = (text.match(/^\s*[-*]\s+/gm) ?? []).length;
  add(bullets === 3, `exactly 3 bullet facts (found ${bullets})`);
  add(text.includes("120ms"), "mentions the p99 latency figure (120ms)");
  add(text.includes("2 million") || /2m\s*events/i.test(text), "mentions the throughput figure");
  add(text.includes("55%") || text.includes("48"), "mentions a storage cost/retention figure");

  // CONVENTION points — only satisfiable via the self-authored AGENTS.md rule
  add(lines[0]?.trim() === "<!-- ACME-DATA-PLATFORM -->", "[convention] line 1 is the ACME marker");
  add(
    /^#\s+Report:.*aurora/i.test((lines[1] ?? "").trim()),
    "[convention] line 2 is '# Report: <Aurora subject>'",
  );
  add(
    /^Classification:\s*INTERNAL\s*$/m.test(text),
    "[convention] contains 'Classification: INTERNAL'",
  );
  const lastNonEmpty = [...lines].reverse().find((l) => l.trim() !== "") ?? "";
  add(
    lastNonEmpty.trim() === "Reviewed-by: Aurora Team",
    "[convention] final line is 'Reviewed-by: Aurora Team'",
  );
  const allFour =
    lines[0]?.trim() === "<!-- ACME-DATA-PLATFORM -->" &&
    /^#\s+Report:.*aurora/i.test((lines[1] ?? "").trim()) &&
    /^Classification:\s*INTERNAL\s*$/m.test(text) &&
    lastNonEmpty.trim() === "Reviewed-by: Aurora Team";
  add(allFour, "[convention] full team format satisfied end-to-end");

  return { score: s, detail };
}

async function collect(run: AsyncGenerator<OmniMessage>): Promise<void> {
  for await (const msg of run) {
    if (isCompleteModelMessage(msg) && msg.payload.type === "text") {
      // keep the demo output focused; the agent's chatter is not the point here
    }
  }
}

/** One evaluation run; returns the score and the report text the agent wrote (for REFLECT). */
async function runOnce(): Promise<{ score: number; detail: string[]; report: string | null }> {
  const agent = await createAgent({ agentId: AGENT_ID });
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "self-evolve-"));
  await fs.writeFile(path.join(ws, "notes.txt"), NOTES, "utf8");
  const session = await agent.createSession({ workspaceDir: ws });
  await collect(session.run([userText(TASK)], { approve: async () => "allow" }));
  let report: string | null = null;
  try {
    report = await fs.readFile(path.join(ws, "summary.md"), "utf8");
  } catch {
    report = null;
  }
  const { score: sc, detail } = score(report);
  return { score: sc, detail, report };
}

const RUNS = 5;
async function evaluate(label: string): Promise<number> {
  console.log(`\n--- ${label}: ${RUNS} runs ---`);
  const scores: number[] = [];
  let lastReport: string | null = null;
  for (let i = 0; i < RUNS; i++) {
    const r = await runOnce();
    scores.push(r.score);
    if (r.report) lastReport = r.report;
    const missed = r.detail.filter((d) => d.startsWith("0")).map((d) => d.replace(/^0\/1\s+/, ""));
    console.log(`  run ${i + 1}: ${r.score}/10   [missed: ${missed.join("; ") || "none"}]`);
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`  ${label} scores: [${scores.join(", ")}]  mean: ${mean.toFixed(2)}/10`);
  (evaluate as unknown as { lastReport?: string | null }).lastReport = lastReport;
  return mean;
}

/** The self-evolution step: the AGENT reads its own failed report + a passing reference, infers the
 *  house convention, and writes it into its OWN AGENTS.md. The script provides no rules. */
async function reflectAndEditOwnState(failedReport: string): Promise<void> {
  const agent = await createAgent({ agentId: AGENT_ID });
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "self-evolve-reflect-"));
  await fs.writeFile(path.join(ws, "last_report.md"), failedReport, "utf8");
  await fs.writeFile(path.join(ws, "reference_report.md"), REFERENCE_REPORT, "utf8");
  const agentsMd = path.join(agentStateDir(), "AGENTS.md");

  const REFLECT = `You are improving your own future performance by editing your persistent instructions.

In your workspace are two files:
- last_report.md — a report you recently wrote that the team REJECTED.
- reference_report.md — a DIFFERENT report (different project) that PASSED the team's review.

Nobody has told you the formatting rules. Read BOTH files, compare them, and infer the team's
reusable report-publishing convention: any required marker line, the title format, required
metadata line(s), and the required footer/sign-off line.

Then WRITE those rules as durable, general guidance into your AGENTS.md at this absolute path:
  ${agentsMd}
(Overwrite the file.) Capture the GENERAL rules that apply to every future report — the exact
fixed lines that never change, and the parts that vary per report (like the subject in the title).
Do NOT copy reference_report.md's specific content. Use your file tools to read the two files and
to write AGENTS.md, then confirm you wrote it.`;

  const session = await agent.createSession({ workspaceDir: ws });
  await collect(session.run([userText(REFLECT)], { approve: async () => "allow" }));
}

async function main(): Promise<void> {
  await createAgent({ agentId: AGENT_ID });
  const agentsMd = path.join(agentStateDir(), "AGENTS.md");
  await fs.writeFile(agentsMd, "", "utf8"); // start blank — the agent knows no convention yet

  // 1. EVALUATE baseline
  const baseline = await evaluate("BASELINE (blank AGENTS.md)");
  const failed = (evaluate as unknown as { lastReport?: string | null }).lastReport ?? "";

  // 2. REFLECT — the agent diagnoses and edits its OWN AGENTS.md
  console.log(
    "\n--- REFLECT: the agent studies a passing example and rewrites its OWN AGENTS.md ---",
  );
  await reflectAndEditOwnState(failed);
  const authored = await fs.readFile(agentsMd, "utf8");
  console.log("\n----- AGENTS.md the agent wrote for itself -----");
  console.log(authored.trim() || "(empty — the agent failed to author a rule)");
  console.log("-----------------------------------------------");

  // 3. RE-EVALUATE with the self-authored rule
  const evolved = await evaluate("N+1 (agent's self-authored convention)");

  // 4. KEEP / ROLL BACK
  console.log("\n=== Self-evolution result ===");
  console.log(`  baseline: ${baseline.toFixed(2)}/10   →   N+1: ${evolved.toFixed(2)}/10`);
  if (evolved > baseline) {
    console.log("  The agent's self-authored edit improved its score — keep it. ✔");
  } else {
    console.log("  No improvement — roll back to the blank AGENTS.md.");
    await fs.writeFile(agentsMd, "", "utf8");
  }
}

main().catch((err) => {
  console.error("Example failed:", err);
  process.exitCode = 1;
});
