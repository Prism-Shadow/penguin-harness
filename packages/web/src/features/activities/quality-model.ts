/**
 * What the Quality block shows, decided without a DOM: the latest reports as the server sent
 * them, the status of each check in words and a tone, one table row per finding, and whether
 * Check quality may be pressed.
 */
import type {
  ActivityRunSummary,
  QualityFinding,
  QualityReport,
  QualityResults,
  QualityStatus,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";

export interface QualityState {
  quality: QualityResults | null;
  /** Unknown counts as installed: the server refuses the run and says so if it is not. */
  browserInstalled: boolean;
}

const isReport = (value: unknown): value is QualityReport =>
  !!value &&
  typeof value === "object" &&
  Array.isArray((value as QualityReport).findings) &&
  typeof (value as QualityReport).status === "string";

/** The server's answer, read defensively. */
export function readQualityState(value: unknown): QualityState {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const quality = raw.quality as QualityResults | null | undefined;
  return {
    quality:
      quality &&
      typeof quality.runId === "string" &&
      isReport(quality.accessibility) &&
      isReport(quality.readability)
        ? quality
        : null,
    browserInstalled: raw.browserInstalled !== false,
  };
}

/** Each status's tone: green passed, red failed, amber with warnings, grey skipped. */
export const STATUS_TONE: Record<QualityStatus, Tone> = {
  passed: "success",
  failed: "danger",
  passed_with_warnings: "attention",
  skipped: "muted",
};

/** A check's status in words; a skipped one says why. */
export function statusText(report: QualityReport): string {
  const words = S.activities.quality;
  const status = words.status[report.status];
  if (report.status !== "skipped" || !report.skippedReason) return status;
  return `${status}. ${words.skipped[report.skippedReason]}`;
}

/** One row of a findings table. */
export interface FindingRow {
  id: string;
  severity: string;
  /** The rule id, or for readability the rule's name. */
  rule: string;
  /** For readability: the word or sentence it is about. */
  subject: string | null;
  where: string;
  detail: string;
  /** Why a finding that would block does not. */
  waived: string | null;
  helpUrl: string | null;
}

function whereText(finding: QualityFinding): string {
  const words = S.activities.quality;
  const parts = [
    ...(finding.scene ? [words.scene(finding.scene)] : []),
    ...(finding.target ? [finding.target] : []),
  ];
  return parts.length ? parts.join(" · ") : words.nowhere;
}

function detailText(finding: QualityFinding): string {
  const words = S.activities.quality;
  if (finding.code in words.keyboard)
    return words.keyboard[finding.code as keyof typeof words.keyboard];
  if (finding.code in words.readabilityDetail && finding.count !== undefined)
    return words.readabilityDetail[finding.code as keyof typeof words.readabilityDetail](
      finding.count,
      finding.limit ?? 0,
    );
  return finding.detail;
}

/** The findings of a report as table rows, in the server's order (most severe first). */
export function findingRows(report: QualityReport): FindingRow[] {
  const words = S.activities.quality;
  return report.findings.map((finding) => {
    const readability = finding.code in words.readabilityRules;
    return {
      id: finding.id,
      severity: words.severity[finding.severity],
      rule: readability
        ? words.readabilityRules[finding.code as keyof typeof words.readabilityRules]
        : finding.code,
      subject: readability ? finding.detail : null,
      where: whereText(finding),
      detail: detailText(finding),
      waived: finding.waived ? words.waived[finding.waived] : null,
      helpUrl: finding.helpUrl && /^https:\/\//.test(finding.helpUrl) ? finding.helpUrl : null,
    };
  });
}

/** The newest quality run, whatever its status. */
export function latestQualityRun(
  runs: readonly ActivityRunSummary[],
): ActivityRunSummary | undefined {
  return runs
    .filter((run) => run.kind === "quality")
    .reduce<ActivityRunSummary | undefined>(
      (newest, run) => (!newest || run.createdAt > newest.createdAt ? run : newest),
      undefined,
    );
}

/** Why Check quality cannot be pressed now, or null when it can. */
export function checkBlocked(input: {
  editable: boolean;
  browserInstalled: boolean;
  runs: readonly ActivityRunSummary[];
  starting: boolean;
}): "readonly" | "browser" | "running" | null {
  if (!input.editable) return "readonly";
  if (!input.browserInstalled) return "browser";
  if (input.starting || input.runs.some((run) => run.status === "running")) return "running";
  return null;
}
