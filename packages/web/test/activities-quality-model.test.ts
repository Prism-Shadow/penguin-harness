/**
 * The Quality block's model: the server's answer read defensively, each status in words and
 * a tone, findings as table rows, and when Check quality may be pressed.
 */
import { describe, expect, it } from "vitest";
import type { ActivityRunSummary, QualityReport } from "@prismshadow/penguin-server/api";
import { S } from "../src/lib/strings";
import {
  STATUS_TONE,
  checkBlocked,
  findingRows,
  latestQualityRun,
  readQualityState,
  statusText,
} from "../src/features/activities/quality-model";

const checkedAt = "2026-09-25T10:00:00.000Z";

const accessibility: QualityReport = {
  check: "accessibility",
  status: "failed",
  checkedAt,
  scenes: ["intro"],
  findings: [
    {
      id: "color-contrast@intro",
      severity: "must",
      blocking: true,
      target: "#choices > button",
      scene: "intro",
      code: "color-contrast",
      detail: "Elements must meet minimum color contrast ratio thresholds",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
      count: 2,
    },
    {
      id: "keyboard-focus-visible@intro",
      severity: "should",
      blocking: true,
      target: "#next",
      scene: "intro",
      code: "keyboard-focus-visible",
      detail: "next",
      count: 1,
    },
    {
      id: "video-caption@",
      severity: "must",
      blocking: false,
      target: null,
      scene: null,
      code: "video-caption",
      detail: "Video elements must have captions",
      helpUrl: "javascript:alert(1)",
      waived: "captions",
    },
  ],
};

const readability: QualityReport = {
  check: "readability",
  status: "passed_with_warnings",
  checkedAt,
  gradeBand: "k-2",
  readingGrade: 3.4,
  findings: [
    {
      id: "sentence_long:0",
      severity: "note",
      blocking: false,
      target: null,
      scene: "intro",
      code: "sentence_long",
      detail: "the big red dog",
      count: 25,
      limit: 10,
    },
  ],
};

const run = (overrides: Partial<ActivityRunSummary>): ActivityRunSummary => ({
  kind: "quality",
  runId: "run_1",
  activityId: "act",
  projectId: "p",
  draftId: "d",
  inputRevision: "r",
  agentId: "",
  sessionId: null,
  status: "succeeded",
  createdAt: "2026-09-25T10:00:00.000Z",
  finishedAt: null,
  error: null,
  hasCandidate: false,
  ...overrides,
});

describe("quality model", () => {
  it("reads the server's answer, and treats anything else as not checked", () => {
    expect(readQualityState({})).toEqual({ quality: null, browserInstalled: true });
    expect(readQualityState({ quality: { runId: "run_1" }, browserInstalled: false })).toEqual({
      quality: null,
      browserInstalled: false,
    });
    const quality = { runId: "run_1", accessibility, readability };
    expect(readQualityState({ quality, browserInstalled: true }).quality).toBe(quality);
  });

  it("names each status and gives it a tone", () => {
    expect(STATUS_TONE).toEqual({
      passed: "success",
      failed: "danger",
      passed_with_warnings: "attention",
      skipped: "muted",
    });
    expect(statusText(accessibility)).toBe(S.activities.quality.status.failed);
    expect(
      statusText({
        check: "readability",
        status: "skipped",
        skippedReason: "no_grade_band",
        findings: [],
        checkedAt,
      }),
    ).toBe(`${S.activities.quality.status.skipped}. ${S.activities.quality.skipped.no_grade_band}`);
  });

  it("lists what must be fixed, where, with a safe link", () => {
    const words = S.activities.quality;
    const rows = findingRows(accessibility);
    expect(rows[0]).toEqual({
      id: "color-contrast@intro",
      severity: words.severity.must,
      rule: "color-contrast",
      subject: null,
      where: `${words.scene("intro")} · #choices > button`,
      detail: "Elements must meet minimum color contrast ratio thresholds",
      waived: null,
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
    });
    expect(rows[1]).toMatchObject({
      severity: words.severity.should,
      detail: words.keyboard["keyboard-focus-visible"],
    });
    expect(rows[2]).toMatchObject({
      where: words.nowhere,
      waived: words.waived.captions,
      helpUrl: null,
    });
  });

  it("words a readability note from its numbers", () => {
    const words = S.activities.quality;
    expect(findingRows(readability)).toEqual([
      {
        id: "sentence_long:0",
        severity: words.severity.note,
        rule: words.readabilityRules.sentence_long,
        subject: "the big red dog",
        where: words.scene("intro"),
        detail: words.readabilityDetail.sentence_long(25, 10),
        waived: null,
        helpUrl: null,
      },
    ]);
  });

  it("finds the newest quality run", () => {
    expect(latestQualityRun([])).toBeUndefined();
    expect(
      latestQualityRun([
        run({ runId: "a", createdAt: "2026-09-25T09:00:00.000Z" }),
        run({ runId: "b", kind: "module", createdAt: "2026-09-25T11:00:00.000Z" }),
        run({ runId: "c", createdAt: "2026-09-25T10:00:00.000Z" }),
      ])?.runId,
    ).toBe("c");
  });

  it("offers Check quality only with the browser and nothing running", () => {
    const base = { editable: true, browserInstalled: true, runs: [], starting: false };
    expect(checkBlocked(base)).toBeNull();
    expect(checkBlocked({ ...base, editable: false })).toBe("readonly");
    expect(checkBlocked({ ...base, browserInstalled: false })).toBe("browser");
    expect(checkBlocked({ ...base, starting: true })).toBe("running");
    expect(checkBlocked({ ...base, runs: [run({ kind: "module", status: "running" })] })).toBe(
      "running",
    );
  });
});
