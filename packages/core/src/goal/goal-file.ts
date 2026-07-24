/**
 * GOAL.yaml — the goal-mode control file, at `<agentDir>/scratchpad/<sessionId>/GOAL.yaml`
 * (path helper: `goalFilePath` in state/paths.ts; sibling of the model's PLAN.md convention).
 *
 * Field ownership (the file is a two-way mailbox with a hard boundary):
 * - `objective`: written once by the goal runner at creation; never changed afterwards.
 * - `status`: the model's only writable field, and only to `complete` / `blocked`; the runner
 *   writes the initial `active` and the system-side terminal `budget_limited`.
 * - `tokens`: refreshed by the runner after every round, **for the model's awareness only** —
 *   budget enforcement always reads the runner's internal counters, never this file, so a
 *   clobbered or stale tokens block can't affect the loop.
 *
 * Reading is deliberately tolerant: the model rewrites the file with shell tools, so a parse
 * failure, a missing file, or an out-of-protocol status all normalize to `blocked` — the loop
 * stops and hands back to the user instead of spinning on a broken control channel.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** `tokens.budget` value meaning "no budget" (also used for an absent budget option). */
export const UNLIMITED_BUDGET = -1;

/**
 * Goal statuses as stored in GOAL.yaml. `active`/`complete`/`blocked` follow the protocol above;
 * `budget_limited` is only ever written by the runner as a terminal state.
 */
export type GoalStatus = "active" | "complete" | "blocked" | "budget_limited";

/** In-memory view of GOAL.yaml (the `remaining` field is derived at write time, never stored here). */
export interface GoalFile {
  objective: string;
  status: GoalStatus;
  tokens: {
    /** Token budget; `UNLIMITED_BUDGET` (-1) means no budget. */
    budget: number;
    used: number;
  };
}

/**
 * Serializes and writes GOAL.yaml (creating the scratchpad session directory if needed — the
 * model normally creates it on demand, but goal mode writes the file before the first round).
 * `tokens.remaining` is emitted only for a real budget, so the model never sees a bogus
 * negative remainder on an unlimited goal.
 */
export async function writeGoalFile(filePath: string, goal: GoalFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tokens: Record<string, number> = {
    budget: goal.tokens.budget,
    used: goal.tokens.used,
  };
  if (goal.tokens.budget > 0) {
    tokens.remaining = Math.max(0, goal.tokens.budget - goal.tokens.used);
  }
  await fs.writeFile(
    filePath,
    stringifyYaml({ objective: goal.objective, status: goal.status, tokens }),
    "utf8",
  );
}

/**
 * Reads the status the model left in GOAL.yaml, normalized to what the loop may act on:
 * `active` / `complete` / `blocked`. Everything else — unreadable file, invalid YAML, a
 * missing or unknown status (including `budget_limited`, which the model must not write) —
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
