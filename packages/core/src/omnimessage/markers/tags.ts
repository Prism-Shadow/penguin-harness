/**
 * The canonical marker tag list — every special marker the product writes into message text,
 * in one place so producers, parsers and the title stripper cannot drift apart.
 *
 * All are spelled `[tag]…[/tag]`; see ./block.ts for the form and the legacy-compat policy.
 */

/** Marker tags that wrap a whole message or a leading block of one. */
export const MARKER_TAGS = {
  /** Interrupted turn, transcribed for resend (engine carry-over). */
  turnAborted: "turn_aborted",
  /** Automatic reconnect retry, carrying the failed attempt's partial output (engine). */
  turnRetried: "turn_retried",
  /** Compaction summary injected as the new context's first input (engine / resume). */
  contextSummary: "context_summary",
  /** The summary the model is asked to write during compaction (compaction prompt / parser). */
  summary: "summary",
  /** Mid-run user message delivered between turns (Session.steer). */
  userSteering: "user_steering",
  /** Goal-mode round protocol block prefixed to each round's input (Session goal loop). */
  goal: "goal",
  /** Skill invocation block prefixed to a user message (Web composer). */
  useSkills: "use_skills",
  /** `/agent` handoff origin block, first message of the delegated conversation (Web). */
  handoffFrom: "handoff_from",
  /** Scheduled-task trigger origin block (server scheduler). */
  scheduledTask: "scheduled_task",
  /** `/model` switch origin block, first message of the continued conversation (Web). */
  modelSwitchFrom: "model_switch_from",
  /** AGENTS.md wrapper inside the system prompt (static template text). */
  developerInstructions: "developer_instructions",
  /** User-scope Memory index wrapper inside the system prompt's Memory block (static template text). */
  userMemoryIndex: "user_memory_index",
  /** Workspace-scope Memory index wrapper inside the system prompt's Memory block (static template text). */
  workspaceMemoryIndex: "workspace_memory_index",
} as const;

/** Inner tags used inside a transcribed turn block (`[turn_aborted]` / `[turn_retried]`). */
export const TRANSCRIPT_TAGS = {
  userInput: "user_input",
  thinking: "thinking",
  text: "text",
  toolCall: "tool_call",
  toolCallOutput: "tool_call_output",
} as const;

/**
 * Machine-inserted marker blocks that must never leak into a generated Session title: the
 * blocks that **prefix a user message** (a skill invocation, a handoff / scheduled-task /
 * model-switch origin note). Engine-synthesized blocks are never title material, so they are
 * deliberately not in this list.
 */
export const TITLE_NOISE_TAGS: readonly string[] = [
  MARKER_TAGS.useSkills,
  MARKER_TAGS.handoffFrom,
  MARKER_TAGS.scheduledTask,
  MARKER_TAGS.modelSwitchFrom,
  MARKER_TAGS.goal,
];
