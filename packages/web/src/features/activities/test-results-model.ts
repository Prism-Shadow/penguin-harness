/**
 * What Test results shows, decided without a DOM: the latest report as the server sent it, the
 * overall status and each criterion's status in words and a tone, one table row per
 * criterion, and whether Run tests may be pressed.
 */
import type {
  AcceptanceReport,
  AcceptanceResult,
  AcceptanceResultStatus,
  ActivityRunSummary,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";

export interface TestState {
  report: AcceptanceReport | null;
  runId: string | null;
  /** How many acceptance criteria the saved specification has. */
  criteria: number;
  /** The report tested another revision of the specification than the saved one. */
  stale: boolean;
  /** Unknown counts as installed: the server refuses the run and says so if it is not. */
  browserInstalled: boolean;
}

const STATUSES = ["passed", "failed", "skipped"] as const;
const isStatus = (value: unknown): value is AcceptanceResultStatus =>
  typeof value === "string" && (STATUSES as readonly string[]).includes(value);

function isResult(value: unknown): value is AcceptanceResult {
  const result = value as AcceptanceResult;
  return (
    !!result &&
    typeof result === "object" &&
    typeof result.criterion === "string" &&
    isStatus(result.status) &&
    typeof result.durationMs === "number"
  );
}

/** The server's answer, read defensively. */
export function readTestState(value: unknown): TestState {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const report = raw.report as AcceptanceReport | null | undefined;
  const valid =
    !!report &&
    isStatus(report.overallStatus) &&
    typeof report.checkedAt === "string" &&
    Array.isArray(report.results) &&
    report.results.every(isResult);
  return {
    report: valid ? report : null,
    runId: valid && typeof raw.runId === "string" ? raw.runId : null,
    criteria: typeof raw.criteria === "number" ? raw.criteria : 0,
    stale: valid && raw.stale === true,
    browserInstalled: raw.browserInstalled !== false,
  };
}

/** Each status's tone: green passed, red failed, grey skipped. */
export const TEST_TONE: Record<AcceptanceResultStatus, Tone> = {
  passed: "success",
  failed: "danger",
  skipped: "muted",
};

/** The report's overall status in words; a skipped one says why. */
export function overallText(report: AcceptanceReport): string {
  const words = S.activities.tests;
  const status = words.status[report.overallStatus];
  if (report.overallStatus !== "skipped" || !report.skippedReason) return status;
  return `${status}. ${words.skipped[report.skippedReason]}`;
}

/** How many criteria passed, of how many, or null for a report with none. */
export function countText(report: AcceptanceReport): string | null {
  if (!report.results.length) return null;
  const passed = report.results.filter((result) => result.status === "passed").length;
  return S.activities.tests.count(passed, report.results.length);
}

/** One row of the results table. */
export interface ResultRow {
  key: string;
  criterion: string;
  testName: string;
  status: AcceptanceResultStatus;
  statusText: string;
  duration: string;
  /** Why it failed or was skipped; empty when it passed. */
  error: string;
}

/** The report's results as table rows, in the specification's order. */
export function resultRows(report: AcceptanceReport): ResultRow[] {
  const words = S.activities.tests;
  return report.results.map((result, index) => ({
    key: `${index}:${result.criterion}`,
    criterion: result.criterion,
    testName: result.testName || words.noTestName,
    status: result.status,
    statusText: words.status[result.status],
    duration: result.code ? "" : words.duration(result.durationMs),
    error: result.code ? words.codes[result.code] : (result.error ?? ""),
  }));
}

/** The newest test run, whatever its status. */
export function latestTestRun(runs: readonly ActivityRunSummary[]): ActivityRunSummary | undefined {
  return runs
    .filter((run) => run.kind === "test")
    .reduce<ActivityRunSummary | undefined>(
      (newest, run) => (!newest || run.createdAt > newest.createdAt ? run : newest),
      undefined,
    );
}

/** Why Run tests cannot be pressed now, or null when it can. */
export function testBlocked(input: {
  editable: boolean;
  hasAgent: boolean;
  unsaved: boolean;
  browserInstalled: boolean;
  criteria: number;
  runs: readonly ActivityRunSummary[];
  starting: boolean;
}): "readonly" | "agent" | "unsaved" | "browser" | "running" | null {
  if (!input.editable) return "readonly";
  if (input.starting || input.runs.some((run) => run.status === "running")) return "running";
  if (input.unsaved) return "unsaved";
  if (!input.hasAgent) return "agent";
  // Without criteria a run needs no browser: it records that there was nothing to test.
  if (input.criteria > 0 && !input.browserInstalled) return "browser";
  return null;
}
