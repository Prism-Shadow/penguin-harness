/**
 * Goal-command parsing (pure logic, shared by chat's `/goal` and run's `--goal`, unit-tested).
 *
 * Chat syntax: `/goal[:<budget>] [--skills <a,b>] <objective>` — the optional budget rides on
 * the command token (`/goal:500k Raise coverage to 80%`); omitting it means no budget; the
 * optional `--skills` token (right after the command) lists installed skills to apply every
 * round. Run passes the budget value (or `true` for a bare `--goal`) and its own `--skills`
 * separately, so only `parseTokenBudget` / `parseSkillNames` apply there.
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

/**
 * Parses a `--skills` value: comma-separated skill names, deduplicated. Returns null when
 * empty, more than 16 names, or any name falls outside `[A-Za-z0-9._-]{1,64}` — the same
 * shape rule the server enforces, because the names render as trusted prompt text in every
 * goal round (unlike the objective, which is escaped into data).
 */
export function parseSkillNames(text: string): string[] | null {
  const names = text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (names.length === 0 || names.length > 16) return null;
  if (names.some((n) => !/^[A-Za-z0-9._-]{1,64}$/.test(n))) return null;
  return [...new Set(names)];
}

export type GoalCommandResult =
  | { ok: true; budget: number; objective: string; skills: string[] }
  | { ok: false; reason: "usage" }
  | { ok: false; reason: "budget"; value: string }
  | { ok: false; reason: "skills"; value: string };

/** Parses a full `/goal…` chat line (the caller has already matched the `/goal` prefix). */
export function parseGoalCommand(line: string): GoalCommandResult {
  const m = /^\/goal(?::(\S+))?(?:\s+([\s\S]+))?$/.exec(line.trim());
  if (!m) return { ok: false, reason: "usage" };
  let rest = m[2]?.trim() ?? "";
  let skills: string[] = [];
  // A leading `--skills` TOKEN (followed by `=`, whitespace, or end of input) is always the
  // option — a missing or empty value is a skills error, never objective text, so a typo'd
  // command can't silently start an unlimited goal named "--skills…". Only an unbroken
  // longer word (e.g. `--skillsful`) stays plain objective text.
  if (/^--skills($|[= \t\n])/.test(rest)) {
    const sm = /^--skills(?:=(\S*)|[ \t]+(\S+))([\s\S]*)$/.exec(rest);
    const value = sm?.[1] ?? sm?.[2] ?? "";
    const names = value === "" ? null : parseSkillNames(value);
    if (names === null) return { ok: false, reason: "skills", value };
    skills = names;
    rest = sm![3]!.trim();
  }
  if (!rest) return { ok: false, reason: "usage" };
  if (m[1] === undefined) return { ok: true, budget: UNLIMITED_BUDGET, objective: rest, skills };
  const budget = parseTokenBudget(m[1]);
  if (budget === null) return { ok: false, reason: "budget", value: m[1] };
  return { ok: true, budget, objective: rest, skills };
}
