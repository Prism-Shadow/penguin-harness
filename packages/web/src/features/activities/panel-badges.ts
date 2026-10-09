/**
 * What the Tests and Quality chips say beside their names, so an author can tell whether
 * either needs them without opening it: a run in progress, how many criteria failed or
 * passed, how many quality findings are open.
 *
 * The page reads the same two routes the panels read, once per settled run and draft
 * revision; the panels keep their own copies, since a chip and an open panel can disagree
 * only for the moment between two reads.
 */
import { useEffect, useState } from "react";
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";
import { latestQualityRun, readQualityState, type QualityState } from "./quality-model";
import { latestTestRun, readTestState, type TestState } from "./test-results-model";

export interface PanelBadge {
  /** The figure on the chip; empty for a run in progress, which shows as a dot. */
  text: string;
  tone: Tone;
  /** The badge in words, for whoever cannot see it. */
  label: string;
}

const running: () => PanelBadge = () => ({
  text: "",
  tone: "busy",
  label: S.activities.panelBadges.running,
});

/** Failed criteria outrank passed ones; a report for an older specification recedes. */
export function testBadge(state: TestState | null, inProgress: boolean): PanelBadge | null {
  if (inProgress) return running();
  const report = state?.report;
  if (!report || !report.results.length) return null;
  const words = S.activities.panelBadges;
  const failed = report.results.filter((result) => result.status === "failed").length;
  if (failed) return { text: String(failed), tone: "danger", label: words.failed(failed) };
  const passed = report.results.filter((result) => result.status === "passed").length;
  if (!passed) return null;
  return {
    text: String(passed),
    tone: state.stale ? "muted" : "success",
    label: state.stale ? words.stale(passed) : words.passed(passed),
  };
}

/** Open findings across both checks; waived ones are settled and do not count. */
export function qualityBadge(state: QualityState | null, inProgress: boolean): PanelBadge | null {
  if (inProgress) return running();
  const quality = state?.quality;
  if (!quality) return null;
  const reports = [quality.accessibility, quality.readability];
  const open = reports.flatMap((report) => report.findings).filter((finding) => !finding.waived);
  if (!open.length) return null;
  const failed = reports.some((report) => report.status === "failed");
  return {
    text: String(open.length),
    tone: failed ? "danger" : "attention",
    label: S.activities.panelBadges.findings(open.length),
  };
}

/** Both chips' badges, read again whenever a run settles or the draft changes. */
export function usePanelBadges(
  endpoint: string,
  runs: readonly ActivityRunSummary[],
  revision: string,
  enabled: boolean,
): { tests: PanelBadge | null; quality: PanelBadge | null } {
  const latestTest = latestTestRun(runs);
  const latestQuality = latestQualityRun(runs);
  const testKey = latestTest ? `${latestTest.runId}:${latestTest.status}` : "";
  const qualityKey = latestQuality ? `${latestQuality.runId}:${latestQuality.status}` : "";
  const [tests, setTests] = useState<TestState | null>(null);
  const [quality, setQuality] = useState<QualityState | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiFetch<unknown>(`${endpoint}/test-report`)
      .then((value) => !cancelled && setTests(readTestState(value)))
      // A chip with nothing to say is the right answer to a read that failed.
      .catch(() => !cancelled && setTests(null));
    return () => {
      cancelled = true;
    };
  }, [endpoint, testKey, revision, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiFetch<unknown>(`${endpoint}/quality`)
      .then((value) => !cancelled && setQuality(readQualityState(value)))
      .catch(() => !cancelled && setQuality(null));
    return () => {
      cancelled = true;
    };
  }, [endpoint, qualityKey, revision, enabled]);

  return {
    tests: enabled ? testBadge(tests, latestTest?.status === "running") : null,
    quality: enabled ? qualityBadge(quality, latestQuality?.status === "running") : null,
  };
}
