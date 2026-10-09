import { describe, expect, it } from "vitest";
import type { AcceptanceReport, QualityReport } from "@prismshadow/penguin-server/api";
import { qualityBadge, testBadge } from "../src/features/activities/panel-badges";
import type { QualityState } from "../src/features/activities/quality-model";
import type { TestState } from "../src/features/activities/test-results-model";

const result = (status: "passed" | "failed" | "skipped") => ({
  criterion: "c",
  status,
  durationMs: 1,
});
const tests = (statuses: ("passed" | "failed" | "skipped")[], stale = false): TestState => ({
  report: {
    overallStatus: statuses.includes("failed") ? "failed" : "passed",
    results: statuses.map(result),
    checkedAt: "2026-10-09T08:00:00Z",
    specRevision: "r1",
    reused: false,
  } as AcceptanceReport,
  runId: "run",
  criteria: statuses.length,
  stale,
  browserInstalled: true,
});
const report = (
  check: "accessibility" | "readability",
  status: QualityReport["status"],
  waived: (string | undefined)[],
): QualityReport =>
  ({
    check,
    status,
    checkedAt: "2026-10-09T08:00:00Z",
    findings: waived.map((reason, index) => ({ id: `${check}-${index}`, waived: reason })),
  }) as unknown as QualityReport;
const quality = (accessibility: QualityReport, readability: QualityReport): QualityState => ({
  quality: { runId: "run", accessibility, readability },
  browserInstalled: true,
});

describe("the Tests chip", () => {
  it("shows a dot while tests run", () => {
    expect(testBadge(tests(["failed"]), true)).toEqual({
      text: "",
      tone: "busy",
      label: "running",
    });
  });

  it("counts failures before passes", () => {
    expect(testBadge(tests(["passed", "failed", "failed"]), false)).toMatchObject({
      text: "2",
      tone: "danger",
      label: "2 failed",
    });
    expect(testBadge(tests(["passed", "passed", "skipped"]), false)).toMatchObject({
      text: "2",
      tone: "success",
    });
  });

  it("lets a report for an older spec recede, and says nothing without one", () => {
    expect(testBadge(tests(["passed"], true), false)?.tone).toBe("muted");
    expect(testBadge(null, false)).toBeNull();
    expect(testBadge(tests([]), false)).toBeNull();
  });
});

describe("the Quality chip", () => {
  it("counts open findings across both checks, leaving waived ones out", () => {
    const state = quality(
      report("accessibility", "passed_with_warnings", [undefined, "vpat"]),
      report("readability", "passed_with_warnings", [undefined]),
    );
    expect(qualityBadge(state, false)).toMatchObject({
      text: "2",
      tone: "attention",
      label: "2 findings open",
    });
  });

  it("turns red when a check failed, and says nothing when all is clear", () => {
    const failed = quality(
      report("accessibility", "failed", [undefined]),
      report("readability", "passed", []),
    );
    expect(qualityBadge(failed, false)?.tone).toBe("danger");
    const clear = quality(
      report("accessibility", "passed", []),
      report("readability", "passed", []),
    );
    expect(qualityBadge(clear, false)).toBeNull();
  });
});
