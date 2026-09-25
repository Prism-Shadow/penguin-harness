/**
 * What the App sees of an activity's quality checks: whether the played activity is easy for
 * everyone to use (accessibility) and whether its words suit its grade band (readability).
 * Type-only, so the web can import it.
 *
 * The server words none of it. A finding is a code with the numbers behind it; the only text
 * it carries is what it points at (a word, a sentence, a selector) and, for an axe rule,
 * axe's own one-line help.
 */

/** How a check came out. Readability never fails: it only warns. */
export type QualityStatus = "passed" | "failed" | "passed_with_warnings" | "skipped";

/** How much a finding matters: Must fix, Should fix, Minor, Note. */
export type QualitySeverity = "must" | "should" | "minor" | "note";

/** Why a check did not run. */
export type QualitySkipReason =
  /** The specification names no `audience.gradeBand`, so there is no level to read against. */
  | "no_grade_band"
  /** The grade band is not one the check knows. */
  | "unknown_grade_band"
  /** The activity's language is not English, and the check reads English only. */
  | "not_english"
  /** The player showed no text and there is no narration script. */
  | "no_text";

/** Why a finding that would block does not. */
export type QualityWaiver =
  /** An admin listed the rule as a VPAT exception (met another way, such as audio first). */
  | "vpat"
  /** A captions rule: reported, never blocking. */
  | "captions";

export interface QualityFinding {
  /** Unique within its report. */
  id: string;
  severity: QualitySeverity;
  /** Whether it fails the check. */
  blocking: boolean;
  /** Where on the page: a CSS selector for an accessibility finding; null when not one element. */
  target: string | null;
  /** The scene it was found in; null when not tied to one. */
  scene: string | null;
  /**
   * What was found: an axe rule id (`color-contrast`), a keyboard rule (`keyboard-focusable`,
   * `keyboard-focus-visible`, `keyboard-activation`), or a readability rule (`sentence_long`,
   * `word_long`, `word_syllables`).
   */
  code: string;
  /** Axe's help text for an axe rule; the control, word or sentence otherwise. */
  detail: string;
  /** Axe's page about the rule. */
  helpUrl?: string;
  /** How many elements (accessibility) or the measured size (readability: words, letters, syllables). */
  count?: number;
  /** The most a readability rule allows for this grade band. */
  limit?: number;
  /** Set when a finding that would block has been let through. */
  waived?: QualityWaiver;
}

export interface QualityReport {
  check: "accessibility" | "readability";
  status: QualityStatus;
  findings: QualityFinding[];
  /** When the check ran (ISO time). */
  checkedAt: string;
  /** Set only when `status` is `skipped`. */
  skippedReason?: QualitySkipReason;
  /** Readability: the grade band read against, as the specification gives it. */
  gradeBand?: string;
  /** Readability: the Flesch-Kincaid grade of the narration and on-screen text, one decimal. */
  readingGrade?: number;
  /** Accessibility: the scenes opened and scanned. */
  scenes?: string[];
}

/** The reports of one finished quality run. */
export interface QualityResults {
  runId: string;
  accessibility: QualityReport;
  readability: QualityReport;
}

/** GET /api/projects/:projectId/activities/:activityId/quality */
export interface QualityStateResponse {
  /** The latest finished quality run's reports; null when none has finished. */
  quality: QualityResults | null;
  /** Whether the test browser the checks open the player in is installed. */
  browserInstalled: boolean;
}

/** GET|PUT /api/admin/activity-quality: the server-wide VPAT exceptions (axe rule ids). */
export interface QualitySettingsResponse {
  vpatExceptions: string[];
}
