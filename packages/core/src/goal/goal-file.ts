/**
 * GOAL.yaml — goal mode's state file, at `<agentDir>/scratchpad/<sessionId>/GOAL.yaml`
 * (path helper: `goalFilePath` in state/paths.ts; sibling of the model's PLAN.md convention).
 *
 * The goal hook (goal-hook.ts) writes the whole file when the goal starts and again after
 * every round — `round` and `tokens_used` refreshed, `status` set to what it decided — so
 * the file is always the goal's current state and hosts restore their display straight
 * from it. `objective` and `budget` are the values the goal was started with; the hook
 * keeps its own copy and writes them back each time, so editing them changes nothing.
 * `status` is the model's one mailbox back to the loop: it may set `complete` or `blocked`
 * and nothing else. `active`, `wrapping_up` (the wrap-up round after the budget ran out),
 * `budget_limited` and `aborted` are the system's.
 *
 * Reading is tolerant: the model rewrites the file with shell tools, so a missing file or
 * unparseable YAML reads as null and an out-of-protocol status reads as `blocked` — a
 * broken control channel stops the loop and hands back to the user instead of spinning.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { atomicWriteFile } from "../internal/atomic-write.js";

/** Budget value meaning "no budget" (also what an omitted budget option becomes). */
export const UNLIMITED_BUDGET = -1;

/** The four ways a goal ends: the two the model may claim, and the two the system decides. */
export const GOAL_OUTCOMES = ["complete", "blocked", "budget_limited", "aborted"] as const;
export type GoalOutcomeStatus = (typeof GOAL_OUTCOMES)[number];

/** Every `status` value: live (`active` / `wrapping_up`) or one of the outcomes. */
export type GoalStatus = "active" | "wrapping_up" | GoalOutcomeStatus;

/** GOAL.yaml in memory (see the header for who writes which field). */
export interface GoalFile {
  objective: string;
  status: GoalStatus;
  /** Token budget for the whole goal; `UNLIMITED_BUDGET` (-1) = none. */
  budget: number;
  /** The round in progress (1-based); on a terminal status, the rounds run. */
  round: number;
  /** Uncached input + output tokens the goal has consumed (subagent sessions included). */
  tokens_used: number;
}

export function isGoalOutcome(status: string): status is GoalOutcomeStatus {
  return (GOAL_OUTCOMES as readonly string[]).includes(status);
}

/** Serializes GOAL.yaml — also what every round's `[goal]` block embeds, so the model sees exactly the file it is asked to edit. */
export function serializeGoalFile(goal: GoalFile): string {
  return stringifyYaml({
    objective: goal.objective,
    status: goal.status,
    budget: goal.budget,
    round: goal.round,
    tokens_used: goal.tokens_used,
  });
}

/** Writes GOAL.yaml (creating the scratchpad session directory when needed — goal mode writes it before the first round). */
export async function writeGoalFile(filePath: string, goal: GoalFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteFile(filePath, serializeGoalFile(goal));
}

const STATUSES: readonly string[] = ["active", "wrapping_up", ...GOAL_OUTCOMES];

/**
 * Reads GOAL.yaml tolerantly: null when the file is missing, unreadable or not a YAML
 * mapping; otherwise the file with an unknown `status` normalized to `blocked` and
 * non-numeric counters to their zero values.
 */
export async function readGoalFile(filePath: string): Promise<GoalFile | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const status = typeof p.status === "string" && STATUSES.includes(p.status) ? p.status : "blocked";
  return {
    objective: typeof p.objective === "string" ? p.objective : "",
    status: status as GoalStatus,
    budget: num(p.budget, UNLIMITED_BUDGET),
    round: num(p.round, 0),
    tokens_used: num(p.tokens_used, 0),
  };
}
