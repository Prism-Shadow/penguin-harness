/**
 * The shapes of "Run all stages", on their own so the App can import them without
 * pulling in the service that runs the stages (see `pipeline-run.ts`).
 */
export const PIPELINE_STEPS = [
  "spec",
  "media",
  "translations",
  "speech",
  "images",
  "assessment",
  "module",
  "test",
] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];
/**
 * Every step, one step, "narration": translating what a language lacks and then speaking
 * it, so a language with empty scripts is voiced in one go, or "assets": speaking and drawing
 * every unbound narration and image, as a ref made from its template does next.
 */
export type PipelineSelection = "all" | "narration" | "assets" | PipelineStep;

export type PipelineStepStatus =
  "pending" | "running" | "succeeded" | "skipped" | "failed" | "cancelled";

export type PipelineNote =
  | "planCurrent"
  | "allTranslated"
  | "needsPenguinAgent"
  | "noNarration"
  | "noImages"
  /** The specification says the activity has no assessment. */
  | "noAssessment"
  /** Only the canonical ref writes the assessment every ref shares. */
  | "notCanonical"
  /** The specification has no acceptance criteria to test. */
  | "noCriteria"
  /** The test browser is not installed, so the tests cannot run. */
  | "noBrowser";

export interface PipelineStepState {
  step: PipelineStep;
  status: PipelineStepStatus;
  /** Why a step failed (the run's own reason), or the asset it is working on. */
  detail: string | null;
  /** Why a step had nothing to do, as a code the App words. */
  note: PipelineNote | null;
  /** Items a media step works through; 0 for single-run steps. */
  done: number;
  total: number;
  runIds: string[];
}

export interface PipelineState {
  pipelineId: string;
  projectId: string;
  activityId: string;
  selection: PipelineSelection;
  /** The media steps' scope, when the sequence was asked for one language or one line. */
  scope: PipelineScope | null;
  status: "running" | "succeeded" | "failed" | "cancelled";
  steps: PipelineStepState[];
  /** The run and Session the sequence is waiting on, for following it live. */
  currentRunId: string | null;
  currentSessionId: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Media steps limited to one language, and optionally to one asset in it. */
export interface PipelineScope {
  language: string;
  assetKey?: string;
}

export interface PipelineInput {
  selection: PipelineSelection;
  scope?: PipelineScope;
  /** The Penguin agent that runs agent steps, or owns the coding agent's Session. */
  agentId: string;
  codingAgentId?: string;
  voice?: string;
  wafRoot?: string;
  bookMode?: "readAlong" | "decodable";
}
