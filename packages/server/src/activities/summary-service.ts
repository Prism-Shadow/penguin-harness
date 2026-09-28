/**
 * The Activities home's per-ref summary: gathers the facts `summarize` needs for every
 * activity of a list. A few reads per activity (its draft, its runs, whether a module
 * exists); a project holds tens of refs, not thousands.
 */
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { Log } from "../hmr/capabilities.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { ActivitySandbox } from "./sandbox-service.js";
import { contentRevision, type ActivityRecord } from "./domain.js";
import { summarize, type ActivitySummary } from "./activity-summary.js";

export abstract class ActivitySummaries extends Interface<{
  forActivities(
    projectId: string,
    activities: readonly ActivityRecord[],
  ): Promise<Record<string, ActivitySummary>>;
}>() {}

@Component()
export class ActivitySummaryService implements ActivitySummaries {
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly sandbox!: ActivitySandbox;
  @Use() private readonly log!: Log;

  /**
   * One broken activity must not take the whole list down: a caller asking for summaries
   * across a project's refs would otherwise lose the page over a single bad row. A failing
   * activity is simply left out of the map; the card renders without a status.
   */
  async forActivities(projectId: string, activities: readonly ActivityRecord[]) {
    const settled = await Promise.allSettled(
      activities.map(async (record) => [record.id, await this.one(projectId, record)] as const),
    );
    const entries: (readonly [string, ActivitySummary])[] = [];
    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") entries.push(result.value);
      else
        this.log.line(
          `[activities] Summary failed for ${activities[index]!.id}: ${String(result.reason)}`,
        );
    }
    return Object.fromEntries(entries);
  }

  private async one(projectId: string, record: ActivityRecord): Promise<ActivitySummary> {
    const [activity, runs, hasModule] = await Promise.all([
      this.activities.getActivity(projectId, record.id),
      this.generation.list(projectId, record.id),
      this.sandbox.hasModule(projectId, record),
    ]);
    const { draft } = activity;
    const plan = draft.mediaPlan;
    return summarize({
      canonical: this.activities.isCanonicalRef(record),
      specValid: draft.status === "valid" && draft.spec !== null,
      plan: !plan
        ? "none"
        : plan.specRevision === contentRevision(draft.spec)
          ? "current"
          : "stale",
      hasModule,
      runningKind: runs.find((run) => run.status === "running")?.kind ?? null,
    });
  }
}
