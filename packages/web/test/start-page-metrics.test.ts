import { describe, expect, it } from "vitest";
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";
import { startMetricsOf } from "../src/lib/start-metrics";

describe("startMetricsOf", () => {
  it("keeps the well-formed counts, the first of a repeated id, in their order", () => {
    const answer = {
      startMetrics: [
        { id: "b", key: "b", title: "Second", order: 20, value: 2, app: "reports" },
        { id: "a", key: "a", title: "First", titleZh: "第一", icon: "trophy", order: 10, value: 7 },
        { id: "a", key: "a", title: "Again", order: 0, value: 9 },
        { id: "", title: "No id", order: 1, value: 1 },
        { id: "c", title: "", order: 1, value: 1 },
        { id: "d", title: "No value", order: 1, value: "3" },
        { id: "e", title: "Endless", order: 1, value: Number.POSITIVE_INFINITY },
        null,
      ],
    };
    expect(startMetricsOf(answer)).toEqual([
      { id: "a", title: "First", titleZh: "第一", icon: "trophy", order: 10, value: 7 },
      { id: "b", title: "Second", order: 20, value: 2, app: "reports" },
    ]);
  });

  it("has none in an answer that sends no list, or no answer at all", () => {
    const older: ContributionsResponse = {
      pages: [],
      fileRenderers: [],
      pageRemovals: [],
      agentTabs: [],
      sessionTabs: [],
    };
    expect(startMetricsOf(older)).toEqual([]);
    expect(startMetricsOf(null)).toEqual([]);
  });
});
