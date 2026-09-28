/**
 * `ActivitySummaryService.forActivities` unit-tested against stubbed dependencies: one
 * activity's `getActivity` throws, and the resulting map must still carry the healthy
 * activity's summary while quietly dropping the broken one (see activity-summary-api's
 * API-level coverage of the happy path).
 */
import { describe, expect, it } from "vitest";
import { ActivitySummaryService } from "../src/activities/summary-service.js";
import type { ActivityRecord } from "../src/activities/domain.js";

const record = (id: string): ActivityRecord =>
  ({
    id,
    collectionId: "col",
    productCode: "ants",
    refNum: 1,
  }) as ActivityRecord;

describe("ActivitySummaryService.forActivities", () => {
  it("leaves a broken activity out of the map instead of failing the whole list", async () => {
    const lines: string[] = [];
    const service = new ActivitySummaryService();
    const healthy = record("act_ok");
    const broken = record("act_broken");
    Object.assign(service, {
      activities: {
        getActivity: async (_projectId: string, activityId: string) => {
          if (activityId === broken.id) throw new Error("boom");
          return {
            ...healthy,
            draft: { status: "valid", spec: null, contentRevision: "rev", mediaPlan: null },
          };
        },
        isCanonicalRef: () => true,
      },
      generation: { list: async () => [] },
      sandbox: { hasModule: async () => false },
      log: { line: (text: string) => lines.push(text) },
    });

    const summaries = await service.forActivities("proj", [healthy, broken]);

    expect(Object.keys(summaries)).toEqual([healthy.id]);
    expect(summaries[healthy.id]).toEqual({
      canonical: true,
      hasPlan: false,
      done: 0,
      total: 3,
      status: { kind: "next", milestone: "spec" },
    });
    expect(lines.some((line) => line.includes(broken.id) && line.includes("boom"))).toBe(true);
  });
});
