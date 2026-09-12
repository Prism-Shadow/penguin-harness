/**
 * The prompts the Evaluation Center sends through the "Create with AI" bridge, and the small
 * id helpers of its manual form. Every prompt ends in a fixed tail that names the Skill to use
 * and the parameters it requires — the Test Agent, the Benchmark id, run and round counts, the
 * target score — so a novice's one-line wish arrives as a request the Skill can act on without
 * asking anything back. The two "Ask AI" tails are the same shape pointed the other way: they
 * name no Skill and ask for no change, carrying the facts already on screen — an evaluation's
 * scores and Session ids, or a case's two material paths — so the answer is read out of the
 * files rather than guessed. The wording lives in the dictionaries; this module only assembles it.
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

/** One case's line in the evaluation question: as the dialog prints it, plus every run's Session id. */
export interface AskEvaluationCase {
  /** The case directory name. */
  id: string;
  score: string;
  cost: string;
  duration: string;
  /** Session id per run, in run order; empty when no run recorded one. */
  sessionIds: string[];
}

/**
 * The facts the evaluation dialog's question carries. Scores, costs and durations arrive
 * already formatted, exactly as the dialog prints them: the display currency and the duration
 * units are the reader's own settings, and a prompt quoting raw numbers would disagree with the
 * screen it was asked from. An absent summary is "", never a placeholder sentence.
 */
export interface AskEvaluationParams {
  benchmarkId: string;
  time: string;
  /** The series label text, or the unlabeled placeholder the legend uses. */
  label: string;
  version: number;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  score: string;
  cost: string;
  duration: string;
  summaryTitle: string;
  summary: string;
  cases: AskEvaluationCase[];
}

export function askEvaluationTail(params: AskEvaluationParams): string {
  return S.benchmark.askEvaluationTail(params);
}

/** The three canned questions of the evaluation dialog's Ask AI panel. */
export function askEvaluationExamples(): AiExample[] {
  return Object.entries(S.benchmark.askEvaluationExamples).map(([key, ex]) => ({
    key,
    label: ex.label,
    prompt: ex.prompt,
  }));
}

/** The facts the case dialog's question carries; formatted values as above. */
export interface AskCaseParams {
  benchmarkId: string;
  caseId: string;
  /** This case's results in the newest evaluation; null when the Benchmark has none yet. */
  latest: { time: string; score: string; runs: { score: string; sessionId: string }[] } | null;
}

export function askCaseTail(params: AskCaseParams): string {
  return S.benchmark.askCaseTail(params);
}

/** The three canned questions of the case dialog's Ask AI panel. */
export function askCaseExamples(): AiExample[] {
  return Object.entries(S.benchmark.askCaseExamples).map(([key, ex]) => ({
    key,
    label: ex.label,
    prompt: ex.prompt,
  }));
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
