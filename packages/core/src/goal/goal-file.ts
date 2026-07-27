/**
 * GOAL.yaml — the goal-mode control file, at `<agentDir>/scratchpad/<sessionId>/GOAL.yaml`
 * (path helper: `goalFilePath` in state/paths.ts; sibling of the model's PLAN.md convention).
 *
 * The system writes this file ONCE, when the goal starts, and never rewrites it:
 * - `objective`: recorded at creation for the model's (and a human's) reference; the
 *   canonical value lives in the loop's memory and is re-stated in every round's [goal]
 *   block, so a tampered file changes nothing.
 * - `status`: the model's only writable field, and only to `complete` / `blocked` — its
 *   mailbox back to the loop, read after every round. System-side endings (budget_limited /
 *   aborted) are reported on the stream (`goal_finished`) and in server state, never written
 *   here: the file always keeps the model's own last write, which is exactly the resume
 *   point an interrupted goal wants.
 *
 * Reading is deliberately tolerant: the model rewrites the file with shell tools, so a parse
 * failure, a missing file, or an out-of-protocol status all normalize to `blocked` — the loop
 * stops and hands back to the user instead of spinning on a broken control channel.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Budget option value meaning "no budget" (also used for an absent budget option). */
export const UNLIMITED_BUDGET = -1;

/** Goal statuses: `active` (initial), `complete` / `blocked` (model-written), `budget_limited` (a stream/state outcome). */
export type GoalStatus = "active" | "complete" | "blocked" | "budget_limited";

/** In-memory view of GOAL.yaml (two fields; see the header for ownership). */
export interface GoalFile {
  objective: string;
  status: GoalStatus;
}

/**
 * Serializes GOAL.yaml from in-memory values. Every round's `[goal]` block embeds this same
 * serialization — composed from the values the file was created with, never read back from
 * the (model-writable) file.
 */
export function serializeGoalFile(goal: GoalFile): string {
  return stringifyYaml({ objective: goal.objective, status: goal.status });
}

/**
 * Serializes and writes GOAL.yaml (creating the scratchpad session directory if needed — the
 * model normally creates it on demand, but goal mode writes the file before the first round).
 * Called exactly once per goal, at creation.
 */
export async function writeGoalFile(filePath: string, goal: GoalFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serializeGoalFile(goal), "utf8");
}

/**
 * Reads the status the model left in GOAL.yaml, normalized to what the loop may act on:
 * `active` / `complete` / `blocked`. Everything else — unreadable file, invalid YAML, a
 * missing or unknown status (including `budget_limited`, which nothing writes to disk) —
 * collapses to `blocked`: a broken control channel stops the loop rather than looping forever.
 */
export async function readGoalStatus(filePath: string): Promise<"active" | "complete" | "blocked"> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return "blocked";
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return "blocked";
  }
  const status = (parsed as { status?: unknown } | null)?.status;
  return status === "active" || status === "complete" ? status : "blocked";
}
