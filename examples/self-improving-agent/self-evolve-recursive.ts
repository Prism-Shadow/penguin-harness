/**
 * RECURSIVE self-evolution — the agent improves its OWN AGENTS.md over MULTIPLE rounds, each round
 * building on the state it authored in the previous round.
 *
 * Why a second round is needed (and is the interesting part):
 *   In round 1 the agent sees ONE accepted report (Borealis). It can infer the STRUCTURE
 *   (marker line / title / classification / footer) but it CANNOT know which tokens are fixed
 *   constants vs per-report variables — a single example is ambiguous. So it generalizes the
 *   marker to a placeholder and guesses the sign-off, and stably lands mid (~7/10).
 *
 *   In round 2 the agent is given SEVERAL accepted reports from DIFFERENT projects that all share
 *   the SAME marker (`<!-- ACME-DATA-PLATFORM -->`) and the SAME footer (`Reviewed-by: Aurora
 *   Team`). Now the invariants are inferable: whatever is identical across every accepted report is
 *   a FIXED constant; whatever varies is a field. The agent reads its OWN round-1 AGENTS.md and
 *   REFINES it to lock those constants down → N+2 climbs to near-ceiling.
 *
 * This is recursion in the true sense: state_{n+1} = agent.reflect(state_n, new_evidence). The
 * script never writes a rule; it only supplies evidence and the keep/rollback signal.
 *
 * Run:  cd examples/self-improving-agent && pnpm exec tsx self-evolve-recursive.ts
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

/** Round 1: a SINGLE accepted report. Structure is inferable; the fixed constants are ambiguous. */
const REFERENCE_1 = `<!-- ACME-DATA-PLATFORM -->
# Report: Project Borealis
Classification: INTERNAL

Borealis is a batch ETL platform migrated to Spark in 2025; it processes about 40TB nightly.

- Cut the nightly window from 6h to 90 minutes
- Runs on a 200-node autoscaling cluster
- Compute costs roughly $12,000/month

Reviewed-by: Aurora Team
`;

/** Round 2: SEVERAL accepted reports from different projects. The marker and the sign-off are
 *  IDENTICAL across all of them (→ fixed constants); the title subject and body vary (→ fields). */
const REFERENCE_2 = `<!-- ACME-DATA-PLATFORM -->
# Report: Project Cascade
Classification: INTERNAL

Cascade is a streaming feature store rolled out in 2026 serving 500 models online.

- p99 read latency 8ms at 300k QPS
- Backed by a Redis + RocksDB tier
- Operates at about $9,500/month

Reviewed-by: Aurora Team
`;
const REFERENCE_3 = `<!-- ACME-DATA-PLATFORM -->
# Report: Project Delta
Classification: INTERNAL

Delta is an internal experimentation platform launched in Q4 2025 running 1,200 concurrent tests.

- Reduced experiment setup from days to under an hour
- Guardrail metrics evaluated hourly
- Infra footprint about $6,000/month

Reviewed-by: Aurora Team
`;

function rootDir(): string {
  return process.env.PENGUIN_HOME ?? path.join(os.homedir(), ".penguin", "data");
}
function agentStateDir(): string {
  return path.join(rootDir(), PROJECT_ID, "agents", AGENT_ID, "agent_state");
}

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

  const bullets = (text.match(/^\s*[-*]\s+/gm) ?? []).length;
  add(bullets === 3, `exactly 3 bullet facts (found ${bullets})`);
  add(text.includes("120ms"), "mentions the p99 latency figure (120ms)");
  add(text.includes("2 million") || /2m\s*events/i.test(text), "mentions the throughput figure");
  add(text.includes("55%") || text.includes("48"), "mentions a storage cost/retention figure");

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
      /* agent chatter suppressed */
    }
  }
}

async function runOnce(): Promise<{ score: number; detail: string[]; report: string | null }> {
  const agent = await createAgent({ agentId: AGENT_ID });
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "self-evolve-r-"));
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
let lastReport = "";
async function evaluate(label: string): Promise<number> {
  console.log(`\n--- ${label}: ${RUNS} runs ---`);
  const scores: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await runOnce();
    scores.push(r.score);
    if (r.report) lastReport = r.report;
    const missed = r.detail.filter((d) => d.startsWith("0")).map((d) => d.replace(/^0\/1\s+/, ""));
    console.log(`  run ${i + 1}: ${r.score}/10   [missed: ${missed.join("; ") || "none"}]`);
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`  ${label} scores: [${scores.join(", ")}]  mean: ${mean.toFixed(2)}/10`);
  return mean;
}

/** Round 1 reflection: infer STRUCTURE from a single accepted example + the agent's own failure. */
async function reflectRound1(failedReport: string): Promise<void> {
  const agent = await createAgent({ agentId: AGENT_ID });
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "self-evolve-r1-"));
  await fs.writeFile(path.join(ws, "last_report.md"), failedReport, "utf8");
  await fs.writeFile(path.join(ws, "accepted_1.md"), REFERENCE_1, "utf8");
  const agentsMd = path.join(agentStateDir(), "AGENTS.md");
  const prompt = `You are improving your own future performance by editing your persistent instructions.

In your workspace:
- last_report.md — a report you wrote that the team REJECTED.
- accepted_1.md — a DIFFERENT project's report that PASSED review.

Nobody has told you the rules. Read both, infer the team's reusable report-publishing convention
(marker line, title format, metadata line, footer/sign-off), and WRITE it as durable general
guidance into your AGENTS.md at this absolute path:
  ${agentsMd}
(Overwrite the file.) Capture the fixed lines and the per-report variable parts. Do not copy the
example's specific content. Use your file tools to read and to write, then confirm.`;
  const session = await agent.createSession({ workspaceDir: ws });
  await collect(session.run([userText(prompt)], { approve: async () => "allow" }));
}

/** Round 2 reflection: RECURSE on the agent's own AGENTS.md using MULTIPLE accepted examples so the
 *  invariants (constant marker + constant sign-off) become inferable and can be locked down. */
async function reflectRound2(): Promise<void> {
  const agent = await createAgent({ agentId: AGENT_ID });
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "self-evolve-r2-"));
  await fs.writeFile(path.join(ws, "accepted_1.md"), REFERENCE_1, "utf8");
  await fs.writeFile(path.join(ws, "accepted_2.md"), REFERENCE_2, "utf8");
  await fs.writeFile(path.join(ws, "accepted_3.md"), REFERENCE_3, "utf8");
  const agentsMd = path.join(agentStateDir(), "AGENTS.md");
  const prompt = `You are refining your own report-publishing convention. Your current convention is
already written in your AGENTS.md at:
  ${agentsMd}
Read it first.

Your workspace now has THREE accepted reports from DIFFERENT projects: accepted_1.md,
accepted_2.md, accepted_3.md. Compare them carefully. The key insight of this round:

  Anything that is IDENTICAL, character-for-character, across ALL THREE accepted reports is a
  FIXED CONSTANT that you must reproduce VERBATIM in every report (for example a specific marker
  line or a specific sign-off line). Anything that DIFFERS between them (like the project name in
  the title, or the body text) is a per-report FIELD you fill in.

Update your AGENTS.md so it records the fixed constants as EXACT literal strings (not placeholders),
and clearly marks which parts vary per report. Overwrite the file at the path above using your file
tools. Then confirm what you changed and why.`;
  const session = await agent.createSession({ workspaceDir: ws });
  await collect(session.run([userText(prompt)], { approve: async () => "allow" }));
}

async function showState(tag: string): Promise<void> {
  const agentsMd = path.join(agentStateDir(), "AGENTS.md");
  const txt = (await fs.readFile(agentsMd, "utf8")).trim();
  console.log(`\n----- ${tag}: AGENTS.md the agent authored -----`);
  console.log(txt || "(empty)");
  console.log("-".repeat(48));
}

async function main(): Promise<void> {
  await createAgent({ agentId: AGENT_ID });
  const agentsMd = path.join(agentStateDir(), "AGENTS.md");
  await fs.writeFile(agentsMd, "", "utf8");

  // N: baseline
  const nBaseline = await evaluate("N  BASELINE (blank AGENTS.md)");
  const failed = lastReport;

  // Round 1: structure from one example
  console.log("\n=== REFLECT round 1: infer STRUCTURE from a single accepted report ===");
  await reflectRound1(failed);
  await showState("after round 1");
  const nPlus1 = await evaluate("N+1 (structure learned)");

  // Round 2: recurse — lock the constants from multiple examples
  console.log(
    "\n=== REFLECT round 2: RECURSE on own AGENTS.md — lock CONSTANTS from 3 examples ===",
  );
  await reflectRound2();
  await showState("after round 2");
  const nPlus2 = await evaluate("N+2 (constants locked)");

  console.log("\n=== Recursive self-evolution trajectory ===");
  console.log(`  N (baseline): ${nBaseline.toFixed(2)}/10`);
  console.log(
    `  N+1 (structure): ${nPlus1.toFixed(2)}/10   (${(nPlus1 - nBaseline >= 0 ? "+" : "") + (nPlus1 - nBaseline).toFixed(2)})`,
  );
  console.log(
    `  N+2 (constants): ${nPlus2.toFixed(2)}/10   (${(nPlus2 - nPlus1 >= 0 ? "+" : "") + (nPlus2 - nPlus1).toFixed(2)})`,
  );
  const monotonic = nPlus1 >= nBaseline && nPlus2 >= nPlus1;
  console.log(
    monotonic
      ? "  Monotonic improvement across two self-authored rounds — recursive self-evolution. ✔"
      : "  Non-monotonic — inspect which round regressed.",
  );
}

main().catch((err) => {
  console.error("Example failed:", err);
  process.exitCode = 1;
});
