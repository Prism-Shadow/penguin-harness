/**
 * The pure parts of acceptance tests: which criteria a specification has, reading what a run's
 * checks wrote (`acceptance-results.json`), and turning that into the run's report.
 *
 * The results file is written by code an agent wrote, so it is read as untrusted: bounded in
 * size by the caller, shape-checked here, and mapped onto the criteria the server recorded
 * when the run started. A criterion no check reported on is failed with `not_run`; a result
 * for something that is not one of the criteria is ignored.
 */
import { createHash } from "node:crypto";
import type {
  AcceptanceOverallStatus,
  AcceptanceReport,
  AcceptanceResult,
  AcceptanceResultStatus,
} from "./acceptance-types.js";

/** The most bytes `acceptance-results.json` may have. */
export const RESULTS_MAX_BYTES = 1024 * 1024;
/** The most criteria one run tests. */
export const MAX_CRITERIA = 100;
/** The longest criterion kept; a longer one is cut here. */
export const CRITERION_MAX = 2000;
/** The longest test name and error kept from a result. */
const NAME_MAX = 300;
const ERROR_MAX = 2000;
/** The most results a results file may list. */
const MAX_RESULTS = 1000;

/** The SHA-256 of a test file, to tell whether a run left the tests it was handed unchanged. */
export function testFileHash(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

const STATUSES: readonly AcceptanceResultStatus[] = ["passed", "failed", "skipped"];

/** A criterion as compared: runs of white space are one space, and the ends trimmed. */
export function normalizeCriterion(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The specification's acceptance criteria (`acceptance_criterias`), in order: non-empty strings,
 * each once, at most `MAX_CRITERIA` of them.
 */
export function acceptanceCriteria(spec: Record<string, unknown> | null): string[] {
  const raw = spec?.acceptance_criterias;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const criterion = normalizeCriterion(entry).slice(0, CRITERION_MAX);
    if (!criterion || seen.has(criterion)) continue;
    seen.add(criterion);
    out.push(criterion);
    if (out.length >= MAX_CRITERIA) break;
  }
  return out;
}

/** The specification's scene ids, in order, each once. */
export function specSceneIds(spec: Record<string, unknown> | null): string[] {
  const scenes = Array.isArray(spec?.scenes) ? (spec!.scenes as unknown[]) : [];
  const ids = scenes
    .map((scene) => (scene && typeof scene === "object" ? (scene as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string" && id.trim() !== "");
  return [...new Set(ids)];
}

/** Whether two lists of criteria are the same criteria in the same order. */
export function sameCriteria(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((criterion, index) => criterion === b[index]);
}

/** One result as the checks reported it, before it is matched to a criterion. */
export interface ReportedResult {
  criterion: string;
  testName: string;
  status: AcceptanceResultStatus;
  durationMs: number;
  error: string | null;
}

/**
 * Reads `acceptance-results.json`: `{ results: [{ criterion, testName, status, durationMs,
 * error? }] }`. Throws a worded error for anything else; the run fails with it.
 */
export function parseAcceptanceResults(text: string): ReportedResult[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("acceptance-results.json is not valid JSON.");
  }
  const results =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { results?: unknown }).results
      : undefined;
  if (!Array.isArray(results))
    throw new Error("acceptance-results.json must be an object with a results list.");
  if (results.length > MAX_RESULTS)
    throw new Error(`acceptance-results.json lists more than ${MAX_RESULTS} results.`);
  return results.map((entry, index) => {
    const where = `Result ${index + 1} in acceptance-results.json`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error(`${where} is not an object.`);
    const record = entry as Record<string, unknown>;
    if (typeof record.criterion !== "string" || !record.criterion.trim())
      throw new Error(`${where} has no criterion.`);
    if (typeof record.status !== "string" || !STATUSES.includes(record.status as never))
      throw new Error(`${where} has a status other than passed, failed or skipped.`);
    const duration = record.durationMs;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0)
      throw new Error(`${where} has no duration.`);
    if (record.error !== undefined && record.error !== null && typeof record.error !== "string")
      throw new Error(`${where} has an error that is not text.`);
    const error = typeof record.error === "string" && record.error.trim() ? record.error : null;
    return {
      criterion: normalizeCriterion(record.criterion),
      testName:
        typeof record.testName === "string" ? record.testName.trim().slice(0, NAME_MAX) : "",
      status: record.status as AcceptanceResultStatus,
      durationMs: Math.round(duration),
      error: error ? error.slice(0, ERROR_MAX) : null,
    };
  });
}

/** Failed when any criterion failed; passed when any passed and none failed; else skipped. */
export function overallStatus(results: readonly AcceptanceResult[]): AcceptanceOverallStatus {
  if (results.some((result) => result.status === "failed")) return "failed";
  if (results.some((result) => result.status === "passed")) return "passed";
  return "skipped";
}

/**
 * The report for `criteria`, in their order: each takes the first reported result for it; one
 * with none is failed with `not_run`.
 */
export function acceptanceReport(
  criteria: readonly string[],
  reported: readonly ReportedResult[],
  meta: { checkedAt: string; specRevision: string | null; reused: boolean },
): AcceptanceReport {
  const results = criteria.map((criterion): AcceptanceResult => {
    const found = reported.find((entry) => entry.criterion === criterion);
    if (!found)
      return {
        criterion,
        testName: "",
        status: "failed",
        durationMs: 0,
        error: null,
        code: "not_run",
      };
    return {
      criterion,
      testName: found.testName,
      status: found.status,
      durationMs: found.durationMs,
      error: found.status === "passed" ? null : found.error,
    };
  });
  return {
    overallStatus: overallStatus(results),
    results,
    checkedAt: meta.checkedAt,
    specRevision: meta.specRevision,
    reused: meta.reused,
  };
}

/** The report of a run with nothing to test. */
export function skippedReport(checkedAt: string, specRevision: string | null): AcceptanceReport {
  return {
    overallStatus: "skipped",
    results: [],
    checkedAt,
    specRevision,
    reused: false,
    skippedReason: "no_criteria",
  };
}

/** A stored report read back, or null when it is not one. */
export function readAcceptanceReport(value: unknown): AcceptanceReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const report = value as AcceptanceReport;
  if (
    !["passed", "failed", "skipped"].includes(report.overallStatus) ||
    !Array.isArray(report.results) ||
    typeof report.checkedAt !== "string"
  )
    return null;
  return report;
}
