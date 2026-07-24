/**
 * Goal-command parsing (pure logic, shared by chat's `/goal` and run's `--goal`, unit-tested).
 *
 * Chat syntax: `/goal[:<budget>] <objective>` — the optional budget rides on the command token
 * (`/goal:500k Raise coverage to 80%`); omitting it means no budget. Run passes the budget
 * value (or `true` for a bare `--goal`) separately, so only `parseTokenBudget` applies there.
 */
import { UNLIMITED_BUDGET } from "@prismshadow/penguin-core";

/**
 * Parses a budget token: a positive number with an optional `k` / `m` suffix
 * (`500k` = 500_000, `1.5m` = 1_500_000, `123456` literal). Returns null when invalid.
 */
export function parseTokenBudget(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([km])?$/i.exec(text.trim());
  if (!m) return null;
  const scale = m[2]?.toLowerCase() === "m" ? 1_000_000 : m[2]?.toLowerCase() === "k" ? 1_000 : 1;
  const value = Math.round(Number(m[1]) * scale);
  return value > 0 ? value : null;
}

export type GoalCommandResult =
  | { ok: true; budget: number; objective: string }
  | { ok: false; reason: "usage" }
  | { ok: false; reason: "budget"; value: string };

/** Parses a full `/goal…` chat line (the caller has already matched the `/goal` prefix). */
export function parseGoalCommand(line: string): GoalCommandResult {
  const m = /^\/goal(?::(\S+))?(?:\s+([\s\S]+))?$/.exec(line.trim());
  if (!m) return { ok: false, reason: "usage" };
  const objective = m[2]?.trim() ?? "";
  if (!objective) return { ok: false, reason: "usage" };
  if (m[1] === undefined) return { ok: true, budget: UNLIMITED_BUDGET, objective };
  const budget = parseTokenBudget(m[1]);
  if (budget === null) return { ok: false, reason: "budget", value: m[1] };
  return { ok: true, budget, objective };
}
