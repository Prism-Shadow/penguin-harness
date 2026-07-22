/**
 * Example: an Agent that improves itself — one turn of the self-improvement loop, in code.
 *
 * This is the "Recursive Self-Improvement" pillar made runnable. It runs entirely on a local
 * open-weight model (Ollama serving qwen3.6:35b) — see README.md for the one-time setup.
 *
 * The loop, exactly as the docs describe it:
 *   1. EVALUATE  — run the agent on a constrained task, score it against a rubric.
 *   2. DIAGNOSE  — read the result to see which rubric points were lost.
 *   3. EDIT      — rewrite the agent's own AGENTS.md to address the failure (version N+1).
 *   4. RE-EVALUATE — run the same task again; keep the change only if the score improved.
 *
 * The rubric here is a *deterministic, transparent* scorer (plain code you can read below), so the
 * before/after numbers are objective and reproducible — no hidden judge. In the full product the
 * Evaluator is driven by the `agent-evaluation` skill against a private rubric; this example
 * distills that idea to its runnable core.
 *
 * It uses a dedicated agent id (`self-improve-demo`) created on the fly, so your existing agents
 * are never touched.
 *
 * Run:  pnpm --dir examples/self-improving-agent start
 *   or: npx tsx examples/self-improving-agent/self-improve.ts
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

/** The constrained task the agent must complete. */
const TASK = `Read notes.txt in your workspace and write summary.md with:
(1) an overview of at most 2 sentences, and
(2) a bullet list of exactly 3 key facts.
The entire summary.md must be under 60 words total.`;

const NOTES = `Project Aurora — Internal Notes

Aurora is a real-time analytics platform launched in Q1 2026. At peak it ingests roughly
2 million events per second through a Kafka-based pipeline. The core query engine was rewritten
in Rust after the original Go version could not keep p99 latency under control; the rewrite cut
p99 from 800ms to 120ms.

The production deployment is single-region with no failover; a multi-region rollout is scheduled
for Q3 2026. Storage is the largest cost line at about $48,000/month, driven by a 90-day
hot-retention policy; cutting retention to 30 days would reduce storage cost by roughly 55%.
`;

/** The "working discipline" we install into AGENTS.md as the N→N+1 edit. */
const DISCIPLINE = `# Working discipline for constrained tasks

When a task lists explicit rules or an exact output format, follow this discipline:

1. Read the source first with a tool before producing any output; never guess file contents.
2. Restate every rule from the task as a short checklist before you start, so none is missed.
3. Actually call the tool to write the required file — do not emit the answer as chat text.
4. Before finishing, re-read your output file and verify it against every rule (file written,
   sentence count, bullet count, word count), fixing any mismatch first.
`;

/** rootDir mirrors the SDK's resolveRoot(): PENGUIN_HOME or ~/.penguin/data. */
function rootDir(): string {
  return process.env.PENGUIN_HOME ?? path.join(os.homedir(), ".penguin", "data");
}

function agentStateDir(): string {
  return path.join(rootDir(), PROJECT_ID, "agents", AGENT_ID, "agent_state");
}

/** Deterministic rubric — 5 independent points, all checkable in code. Returns {score, detail}. */
function score(
  summaryPath: string,
  summaryText: string | null,
): { score: number; detail: string[] } {
  const detail: string[] = [];
  let s = 0;
  const exists = summaryText !== null;
  detail.push(`${exists ? "1" : "0"}/1  file summary.md was actually written`);
  if (!exists) return { score: 0, detail };
  s += 1;

  const body = summaryText.replace(/^#.*$/gm, "").trim(); // drop a markdown title line if present
  const overview = body.split(/\n\s*[-*]/)[0] ?? ""; // text before the first bullet
  const sentences = (overview.match(/[.!?](\s|$)/g) ?? []).length;
  const okSentences = sentences >= 1 && sentences <= 2;
  detail.push(`${okSentences ? "1" : "0"}/1  overview is ≤ 2 sentences (found ${sentences})`);
  if (okSentences) s += 1;

  const bullets = (summaryText.match(/^\s*[-*]\s+/gm) ?? []).length;
  const okBullets = bullets === 3;
  detail.push(`${okBullets ? "1" : "0"}/1  exactly 3 bullet facts (found ${bullets})`);
  if (okBullets) s += 1;

  const words = body.split(/\s+/).filter(Boolean).length;
  const okWords = words < 60;
  detail.push(`${okWords ? "1" : "0"}/1  under 60 words (found ${words})`);
  if (okWords) s += 1;

  // "facts accurate": require at least two of the source's hard numbers to appear.
  const anchors = ["120ms", "55%", "2 million", "$48,000", "Q3 2026", "800ms"];
  const hits = anchors.filter((a) => summaryText.includes(a)).length;
  const okFacts = hits >= 2;
  detail.push(`${okFacts ? "1" : "0"}/1  key facts accurate (${hits} source figures present)`);
  if (okFacts) s += 1;

  void summaryPath;
  return { score: s, detail };
}

async function drain(run: AsyncGenerator<OmniMessage>): Promise<void> {
  for await (const msg of run) {
    if (isCompleteModelMessage(msg) && msg.payload.type === "text") {
      process.stdout.write(msg.payload.text + "\n");
    }
  }
}

/** Run the task once in a fresh temp workspace seeded with notes.txt; return the rubric score. */
async function runOnce(): Promise<{ score: number; detail: string[] }> {
  const agent = await createAgent({ agentId: AGENT_ID });
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "self-improve-"));
  await fs.writeFile(path.join(ws, "notes.txt"), NOTES, "utf8");

  const session = await agent.createSession({ workspaceDir: ws });
  await drain(session.run([userText(TASK)], { approve: async () => "allow" }));

  const summaryPath = path.join(ws, "summary.md");
  let text: string | null = null;
  try {
    text = await fs.readFile(summaryPath, "utf8");
  } catch {
    text = null;
  }
  return score(summaryPath, text);
}

/**
 * Evaluate a version by averaging over RUNS independent runs. Small local models are
 * nondeterministic, so a single run is noisy — averaging is exactly why real benchmarks use a
 * `runs` count per case. Returns the mean score.
 */
const RUNS = 3;
async function evaluate(label: string): Promise<number> {
  console.log(`\n--- ${label}: ${RUNS} runs ---`);
  const scores: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await runOnce();
    scores.push(r.score);
    console.log(`  run ${i + 1}: ${r.score}/5`);
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`  ${label} mean: ${mean.toFixed(2)}/5`);
  return mean;
}

async function main(): Promise<void> {
  // Ensure the demo agent exists, then start from a blank AGENTS.md (the baseline).
  await createAgent({ agentId: AGENT_ID });
  const agentsMd = path.join(agentStateDir(), "AGENTS.md");
  await fs.writeFile(agentsMd, "", "utf8");

  // --- Turn N: evaluate the baseline ---------------------------------------------------
  const baseline = await evaluate("BASELINE (blank AGENTS.md)");

  // --- Edit: install the working discipline (version N+1) ------------------------------
  console.log("\n--- EDIT: writing a working-discipline section into the agent's AGENTS.md ---");
  await fs.writeFile(agentsMd, DISCIPLINE, "utf8");

  // --- Turn N+1: re-evaluate the same task --------------------------------------------
  const improved = await evaluate("N+1 (with working discipline)");

  // --- Keep-or-roll-back: the loop's decision rule ------------------------------------
  console.log("\n=== Self-improvement result ===");
  console.log(`  baseline: ${baseline.toFixed(2)}/5   →   N+1: ${improved.toFixed(2)}/5`);
  if (improved > baseline) {
    console.log("  Mean score improved — keep version N+1. ✔");
  } else {
    console.log("  No improvement — roll back to the baseline AGENTS.md.");
    await fs.writeFile(agentsMd, "", "utf8");
  }
}

main().catch((err) => {
  console.error("Example failed:", err);
  process.exitCode = 1;
});
