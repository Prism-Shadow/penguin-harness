/**
 * The prompts the Evaluation Center sends through the "Create with AI" bridge, and the small
 * id helpers of its manual form. Every prompt ends in a fixed tail that names the Skill to use
 * and the parameters it requires — the Test Agent, the Benchmark id, run and round counts, the
 * target score — so a novice's one-line wish arrives as a request the Skill can act on without
 * asking anything back. The wording lives in the dictionaries; this module only assembles it.
 */
import { S } from "../../lib/strings";
import { composeAiPrompt } from "../ai-create/ai-create-prompt";
import type { AiExample } from "../ai-create/ai-create-panel";

/** Directory names and Benchmark ids share the Agent id alphabet. */
export const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Upper bound on runs per case, matched by the create route: every run is one evaluation of the
 * Test Agent, so the count multiplies the cost of each evaluation and optimization round. The
 * Use dialog refuses anything beyond it, so a Benchmark must not be created above it either.
 */
export const MAX_RUNS = 1000;

/** A digits-only runs field within [1, MAX_RUNS]. */
export function isValidRuns(raw: string): boolean {
  if (!/^\d+$/.test(raw)) return false;
  const n = Number.parseInt(raw, 10);
  return n >= 1 && n <= MAX_RUNS;
}

/** What the New Benchmark dialog's tail asks the `benchmark-design` Skill to do for a tested Agent. */
export function benchmarkCreateTail(targetAgentId: string): string {
  return S.benchmark.aiCreateTail(targetAgentId);
}

export function benchmarkCreateExamples(): AiExample[] {
  return Object.entries(S.benchmark.aiCreateExamples).map(([key, ex]) => ({
    key,
    label: ex.label,
    description: ex.description,
    prompt: ex.prompt,
  }));
}

/** The parameters the `agent-evaluation` Skill requires, as the Evaluate tab collects them. */
export interface EvaluateParams {
  /** The Agent under test: the one the matrix is run against, picked in the dialog. */
  targetAgentId: string;
  benchmarkId: string;
  /** Runs per case; the matrix is Case x runs. */
  runs: number;
}

export function evaluateTail(params: EvaluateParams): string {
  return S.benchmark.evaluateTail(params);
}

/** The whole Evaluate prompt: the optional note first, then the parameter tail. */
export function buildEvaluatePrompt(note: string, params: EvaluateParams): string {
  return composeAiPrompt(note, evaluateTail(params));
}

/** The parameters the `agent-optimization` Skill requires, as the Optimize tab collects them. */
export interface OptimizeParams {
  /** The Agent under test: the one the optimizer edits, picked in the dialog. */
  targetAgentId: string;
  benchmarkId: string;
  /** Runs per case for every Candidate. */
  runs: number;
  /** Complete valid Candidate rounds before the optimizer stops. */
  roundLimit: number;
  /** Reaching it ends the loop early. */
  targetScore: number;
}

export function optimizeTail(params: OptimizeParams): string {
  return S.benchmark.optimizeTail(params);
}

/** The whole Optimize prompt: the optional focus text first, then the parameter tail. */
export function buildOptimizePrompt(focus: string, params: OptimizeParams): string {
  return composeAiPrompt(focus, optimizeTail(params));
}

/** A Benchmark's directory relative to the Project's App Data Dir — beside `agents/`, not under one. */
export function benchmarkPath(benchmarkId: string): string {
  return `benchmarks/${benchmarkId}`;
}

/**
 * A directory-name proposal from a title: ASCII letters and digits kept (lowercased), any run
 * of other characters folded into one hyphen, edges trimmed. A title with no ASCII word — a
 * Chinese one — yields "", and the form then asks for an id outright.
 */
export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `CASE-NNN-<slug>`: the case directory name from its 1-based position and slug. */
export function caseId(index: number, slug: string): string {
  return `CASE-${String(index).padStart(3, "0")}-${slug}`;
}
