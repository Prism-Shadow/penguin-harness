import { describe, expect, it } from "vitest";
import type { AcceptanceReport, ActivityRunSummary } from "@prismshadow/penguin-server/api";
import {
  TEST_TONE,
  countText,
  latestTestRun,
  overallText,
  readTestState,
  resultRows,
  testBlocked,
} from "../src/features/activities/test-results-model";

const report: AcceptanceReport = {
  overallStatus: "failed",
  checkedAt: "2026-09-25T10:00:00.000Z",
  specRevision: "rev",
  reused: true,
  results: [
    {
      criterion: "Tapping the cat plays its name.",
      testName: "tap the cat",
      status: "passed",
      durationMs: 1540,
      error: null,
    },
    {
      criterion: "The end screen says well done.",
      testName: "end screen",
      status: "failed",
      durationMs: 820,
      error: "Expected state end, saw intro.",
    },
    {
      criterion: "The art is friendly.",
      testName: "",
      status: "failed",
      durationMs: 0,
      error: null,
      code: "not_run",
    },
  ],
};

function run(overrides: Partial<ActivityRunSummary>): ActivityRunSummary {
  return {
    kind: "test",
    runId: "run_1",
    activityId: "act",
    projectId: "proj",
    draftId: "draft",
    inputRevision: "1",
    agentId: "agent",
    sessionId: "s",
    status: "succeeded",
    createdAt: "2026-09-25T09:00:00.000Z",
    finishedAt: null,
    error: null,
    hasCandidate: false,
    ...overrides,
  };
}

describe("test results model", () => {
  it("reads the server's answer defensively", () => {
    expect(
      readTestState({ report, runId: "run_1", criteria: 3, stale: true, browserInstalled: true }),
    ).toEqual({
      report,
      runId: "run_1",
      criteria: 3,
      stale: true,
      browserInstalled: true,
    });
    expect(
      readTestState({ report: { overallStatus: "odd", results: [], checkedAt: "x" }, runId: "r" }),
    ).toEqual({ report: null, runId: null, criteria: 0, stale: false, browserInstalled: true });
    expect(readTestState(null)).toEqual({
      report: null,
      runId: null,
      criteria: 0,
      stale: false,
      browserInstalled: true,
    });
    // Without a report there is nothing to be out of date.
    expect(readTestState({ stale: true }).stale).toBe(false);
    expect(readTestState({ browserInstalled: false }).browserInstalled).toBe(false);
  });

  it("words the overall status and the count, and says why a report was skipped", () => {
    expect(overallText(report)).toBe("Failed");
    expect(countText(report)).toBe("1 of 3 criteria passed");
    const skipped: AcceptanceReport = {
      ...report,
      overallStatus: "skipped",
      results: [],
      skippedReason: "no_criteria",
    };
    expect(overallText(skipped)).toBe("Skipped. The specification has no acceptance criteria.");
    expect(countText(skipped)).toBeNull();
    expect(TEST_TONE).toEqual({ passed: "success", failed: "danger", skipped: "muted" });
  });

  it("lists one row per criterion with its status in words, time and reason", () => {
    expect(resultRows(report)).toEqual([
      {
        key: "0:Tapping the cat plays its name.",
        criterion: "Tapping the cat plays its name.",
        testName: "tap the cat",
        status: "passed",
        statusText: "Passed",
        duration: "1.5 s",
        error: "",
      },
      {
        key: "1:The end screen says well done.",
        criterion: "The end screen says well done.",
        testName: "end screen",
        status: "failed",
        statusText: "Failed",
        duration: "820 ms",
        error: "Expected state end, saw intro.",
      },
      {
        key: "2:The art is friendly.",
        criterion: "The art is friendly.",
        testName: "None",
        status: "failed",
        statusText: "Failed",
        duration: "",
        error: "No check ran for this criterion.",
      },
    ]);
  });

  it("finds the newest test run among other runs", () => {
    const runs = [
      run({ runId: "old", createdAt: "2026-09-25T08:00:00.000Z" }),
      run({ runId: "quality", kind: "quality", createdAt: "2026-09-25T11:00:00.000Z" }),
      run({ runId: "new", createdAt: "2026-09-25T10:00:00.000Z" }),
    ];
    expect(latestTestRun(runs)?.runId).toBe("new");
    expect(latestTestRun([])).toBeUndefined();
  });

  it("says why Run tests cannot be pressed", () => {
    const base = {
      editable: true,
      hasAgent: true,
      unsaved: false,
      browserInstalled: true,
      criteria: 2,
      runs: [] as ActivityRunSummary[],
      starting: false,
    };
    expect(testBlocked(base)).toBeNull();
    expect(testBlocked({ ...base, editable: false })).toBe("readonly");
    expect(testBlocked({ ...base, runs: [run({ status: "running" })] })).toBe("running");
    expect(testBlocked({ ...base, starting: true })).toBe("running");
    expect(testBlocked({ ...base, unsaved: true })).toBe("unsaved");
    expect(testBlocked({ ...base, hasAgent: false })).toBe("agent");
    expect(testBlocked({ ...base, browserInstalled: false })).toBe("browser");
    // Nothing to test needs no browser: the run records that.
    expect(testBlocked({ ...base, browserInstalled: false, criteria: 0 })).toBeNull();
  });
});
