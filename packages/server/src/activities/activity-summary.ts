/**
 * What the Activities home says about one ref: how far along it is and the one thing
 * worth knowing now. Three milestones — the facts the studio already gates its sections
 * on — rather than the nine pipeline stages, which nothing running computes per activity.
 * Type-only imports, so the web can read these types without pulling in services.
 */
import type { ActivityRun } from "./domain.js";

export type SummaryMilestone = "spec" | "mediaPlan" | "module";
export const SUMMARY_MILESTONES: readonly SummaryMilestone[] = ["spec", "mediaPlan", "module"];

export type ActivitySummaryStatus =
  | { kind: "running"; runKind: ActivityRun["kind"] }
  | { kind: "stale"; what: "mediaPlan" }
  | { kind: "built" }
  | { kind: "next"; milestone: SummaryMilestone };

export interface ActivitySummary {
  canonical: boolean;
  /** Any media plan, current or not: what a new ref copies, so the New ref card waits for it. */
  hasPlan: boolean;
  done: number;
  total: number;
  status: ActivitySummaryStatus;
}

export interface SummaryFacts {
  canonical: boolean;
  specValid: boolean;
  plan: "none" | "current" | "stale";
  hasModule: boolean;
  runningKind: ActivityRun["kind"] | null;
}

export function summarize(facts: SummaryFacts): ActivitySummary {
  const reached: Record<SummaryMilestone, boolean> = {
    spec: facts.specValid,
    mediaPlan: facts.plan === "current",
    module: facts.hasModule,
  };
  const done = SUMMARY_MILESTONES.filter((milestone) => reached[milestone]).length;
  const missing = SUMMARY_MILESTONES.find((milestone) => !reached[milestone]);
  // Precedence: live work, then something that needs redoing, then finished, then next.
  const status: ActivitySummaryStatus = facts.runningKind
    ? { kind: "running", runKind: facts.runningKind }
    : facts.plan === "stale"
      ? { kind: "stale", what: "mediaPlan" }
      : missing
        ? { kind: "next", milestone: missing }
        : { kind: "built" };
  return {
    canonical: facts.canonical,
    hasPlan: facts.plan !== "none",
    done,
    total: SUMMARY_MILESTONES.length,
    status,
  };
}
