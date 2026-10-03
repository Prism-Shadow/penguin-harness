/**
 * The Activity's model: the ActionRuns of an organization as the view lists them — newest first,
 * one page at a time — what each run's outcome reads as, and the filters a person types.
 */
import type { ActionRunOutcome, ActionRunView } from "@prismshadow/penguin-server/api";
import type { ActionRunsFilter } from "../../api/endpoints";
import type { Tone } from "../../lib/tone";

/** How a run stands: its outcome, or `running` while it has none. */
export type RunState = ActionRunOutcome | "running";

export function runState(run: ActionRunView): RunState {
  return run.outcome ?? "running";
}

/**
 * The tone of a run's state, by meaning: running is live work; a succeeded run finished well; a
 * failed one failed; a refused, aborted or abandoned one did not happen as asked but broke
 * nothing, so it is something to look at rather than an error.
 */
export const RUN_TONE: Record<RunState, Tone> = {
  running: "busy",
  succeeded: "success",
  failed: "danger",
  refused: "attention",
  aborted: "attention",
  abandoned: "attention",
};

/** Newest first: by start time, then by id (the server's own order). */
export function newestFirst(a: ActionRunView, b: ActionRunView): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The runs listed so far with the next page appended: one entry per run, newest first. */
export function appendRuns(
  shown: readonly ActionRunView[],
  page: readonly ActionRunView[],
): ActionRunView[] {
  const byId = new Map(shown.map((r) => [r.id, r]));
  for (const r of page) byId.set(r.id, r);
  return [...byId.values()].sort(newestFirst);
}

/** What the person typed into the filters. */
export interface RunFilterForm {
  subject: string;
  by: string;
  key: string;
}

export const EMPTY_FILTER: RunFilterForm = { subject: "", by: "", key: "" };

/** The query a form asks for: each filter trimmed, the empty ones left out. */
export function filterOf(form: RunFilterForm, before?: string): ActionRunsFilter {
  const out: ActionRunsFilter = {};
  if (form.subject.trim() !== "") out.subject = form.subject.trim();
  if (form.by.trim() !== "") out.by = form.by.trim();
  if (form.key.trim() !== "") out.key = form.key.trim();
  if (before !== undefined) out.before = before;
  return out;
}

/** Why a run did not succeed, as one line: its code and message; null for one that did or runs. */
export function failureOf(run: ActionRunView): string | null {
  if (run.outcome === null || run.outcome === "succeeded") return null;
  const parts = [run.code, run.message].filter((x): x is string => x !== null && x !== "");
  return parts.length === 0 ? null : parts.join(": ");
}
