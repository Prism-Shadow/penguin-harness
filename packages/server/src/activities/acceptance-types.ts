/**
 * The shapes of acceptance tests, on their own so the App can import them without pulling in
 * the service that runs them (see `acceptance-service.ts`).
 *
 * An acceptance test run turns each acceptance criterion of the specification
 * (`acceptance_criterias`) into a check an agent writes against Penguin's harness API, runs it
 * in the test browser against the played activity, and keeps one report per run.
 */

/** How one criterion's check ended. */
export type AcceptanceResultStatus = "passed" | "failed" | "skipped";

/** The report as a whole: failed when any criterion failed, skipped when none was checked. */
export type AcceptanceOverallStatus = "passed" | "failed" | "skipped";

/** Why a criterion failed without its check saying so, as a code the App words. */
export type AcceptanceResultCode = "not_run";

/** Why a whole report was skipped, as a code the App words. */
export type AcceptanceSkipReason = "no_criteria";

export interface AcceptanceResult {
  /** The criterion, as the specification words it. */
  criterion: string;
  /** What the agent named the check that tests it; empty when it never ran. */
  testName: string;
  status: AcceptanceResultStatus;
  durationMs: number;
  /** Why it failed or was skipped, in the check's own words; null when it passed. */
  error: string | null;
  /** Set when the server, not the check, decided the status. */
  code?: AcceptanceResultCode;
}

export interface AcceptanceReport {
  overallStatus: AcceptanceOverallStatus;
  /** One per criterion, in the specification's order. */
  results: AcceptanceResult[];
  checkedAt: string;
  /** The specification revision the criteria came from; null when there was no specification. */
  specRevision: string | null;
  /** Whether the run reused the tests an earlier run wrote for the same criteria. */
  reused: boolean;
  skippedReason?: AcceptanceSkipReason;
}

/** GET /:activityId/test-report. */
export interface AcceptanceStateResponse {
  /** The latest finished test run's report; null when tests have never finished. */
  report: AcceptanceReport | null;
  runId: string | null;
  /** How many acceptance criteria the saved specification has now. */
  criteria: number;
  /** The report tested another revision of the specification than the saved one. */
  stale: boolean;
  browserInstalled: boolean;
}

/** What a test run is given in its workspace as `acceptance-input.json`. */
export interface AcceptanceInput {
  /** A signed link that plays the activity, for the test browser on this machine. */
  playUrl: string;
  viewport: { width: number; height: number };
  criteria: string[];
  /** The test browser's executable. */
  browserPath: string;
  /** The specification's scene ids, in order. */
  scenes: string[];
  specRevision: string;
}

/** What a test run records about itself, so its report never depends on files the agent could edit. */
export interface AcceptanceRunRecord {
  criteria: string[];
  specRevision: string;
  /** The harness API the tests were written against; tests for another one are not reused. */
  harnessVersion: number;
  /**
   * Whether it was handed an earlier run's tests. The report says they were reused only when
   * the test file still matches `cachedTestHash` once the run ends.
   */
  reused: boolean;
  /** The SHA-256 of the test file it was handed; absent when it was handed none. */
  cachedTestHash?: string;
}

/** A test run's start, as the acceptance service hands it to the generation service. */
export interface AcceptanceStage {
  input: AcceptanceInput;
  /** An earlier run's `acceptance.test.mjs` for the same criteria, reused as it is; null to write one. */
  cachedTest: string | null;
  /** The `playwright-core` version the harness installs: the one this server drives. */
  playwrightVersion: string;
}
