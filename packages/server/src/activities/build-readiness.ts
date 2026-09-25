/**
 * Whether an activity is ready to assemble, as a list of checks an author can read before
 * pressing Assemble: the facts only the server can establish (is the media plan current
 * for the saved specification, does this ref own the module code), and the counts behind
 * "all speech bound" and "every language covers the default one".
 *
 * Checks carry codes and numbers, never sentences; the App words them. A check that fails
 * is one the App does not offer Assemble with; a warning is one it allows, but that leaves
 * the module short of something an author would want.
 */
import { assessmentTitle } from "./assessment-document.js";
import { usesAssessment } from "./behavior-path.js";
import { contentRevision, type ActivityDetail } from "./domain.js";
import { conflictingMediaKeys } from "./media-markup.js";
import { assessmentProblemCounts } from "./module-overrides.js";
import type { ReadinessCheck } from "./readiness-types.js";
import { isAssessmentData } from "./sandbox-assessment.js";
import { wordRecordingCounts } from "./pronunciation.js";

export type { ReadinessCheck, ReadinessLevel } from "./readiness-types.js";

export interface ReadinessContext {
  canonical: boolean;
  checkoutFound: boolean;
  /** The assessment in effect for this ref (an author's edit, else the module's own), or null. */
  assessment?: unknown;
  /** The module's own assessment file, ignoring an author's edit, or null when it has none. */
  ownAssessment?: unknown;
  /** The product's canonical ref, whose number the shared assessment's title carries. */
  canonicalRefNum?: number | null;
  /** A book's recorded reading mode, or null when its product records none. */
  bookMode?: "decodable" | "readAlong" | null;
}

const DEFAULT_LANGUAGE = "en-US";

/**
 * An assessment's problems: the rules an author's save is held to, and a title that names
 * the file it is kept in (`<product>-<ref>`, this ref's or the canonical ref's). A problem the
 * module's own file already had is only a warning, as it is when an author saves: many real
 * modules have some. One the assessment in effect adds, or no assessment at all, fails.
 */
function assessmentCheck(
  activity: ActivityDetail,
  context: ReadinessContext,
): ReadinessCheck | null {
  if (!usesAssessment(activity.draft.spec)) return null;
  const document = context.assessment ?? null;
  if (document === null) return { id: "assessment", level: "fail", state: "missing", problems: 0 };
  const own = context.ownAssessment ?? null;
  const titles = [activity.refNum, context.canonicalRefNum ?? activity.refNum].map((ref) =>
    assessmentTitle(activity.productCode, ref),
  );
  const titleWrong = (value: unknown) =>
    isAssessmentData(value) && !titles.includes(String(value.title));
  const counts = assessmentProblemCounts(document, own);
  const title = titleWrong(document) ? 1 : 0;
  const problems = counts.total + title;
  const introduced = counts.introduced + (title && !titleWrong(own) ? 1 : 0);
  if (!problems) return { id: "assessment", level: "ok", state: "valid", problems: 0 };
  return { id: "assessment", level: introduced ? "fail" : "warn", state: "problems", problems };
}

export function buildReadiness(
  activity: ActivityDetail,
  context: ReadinessContext,
): ReadinessCheck[] {
  const { draft } = activity;
  const checks: ReadinessCheck[] = [
    { id: "script", level: draft.description.trim() ? "ok" : "warn" },
    { id: "spec", level: draft.spec && draft.status === "valid" ? "ok" : "fail" },
  ];
  const plan = draft.mediaPlan;
  const planState = !plan
    ? "missing"
    : draft.spec && plan.specRevision === contentRevision(draft.spec)
      ? "current"
      : "stale";
  // Assembly without a plan is allowed and simply carries no media; a stale plan is not.
  checks.push({
    id: "plan",
    level: planState === "current" ? "ok" : planState === "stale" ? "fail" : "warn",
    state: planState,
  });
  if (plan) {
    const languages = Object.keys(plan.manifest.assets).sort((a, b) =>
      a === DEFAULT_LANGUAGE ? -1 : b === DEFAULT_LANGUAGE ? 1 : a.localeCompare(b),
    );
    const defaults = plan.manifest.assets[DEFAULT_LANGUAGE] ?? [];
    // What a language has to say differently: the default's scripted narration. Music and
    // effects carry no script and fall back to the default, as in Loom.
    const defaultSpeech = new Set(
      defaults
        .filter((asset) => asset.type === "audio" && !asset.kind && !!asset.script?.trim())
        .map((asset) => asset.key),
    );
    for (const language of languages) {
      // A book's word pronunciations are recorded with the words, not as narration.
      const audio = plan.manifest.assets[language]!.filter(
        (asset) => asset.type === "audio" && asset.role !== "bookWord",
      );
      const bound = audio.filter((asset) => asset.path).length;
      if (audio.length)
        checks.push({
          id: "speech",
          level: bound === audio.length ? "ok" : "warn",
          language,
          bound,
          total: audio.length,
        });
      // A decodable book's words: each needs a recording, timed sound by sound, for the
      // reader to sound it out. A book whose product records no mode but has word
      // pronunciations was refreshed as decodable; a decodable book with none in its default
      // language has not listed its words yet.
      const words = wordRecordingCounts(plan.manifest.assets[language]!);
      if (
        activity.activityType === "book" &&
        context.bookMode !== "readAlong" &&
        (words.total > 0 || (context.bookMode === "decodable" && language === DEFAULT_LANGUAGE))
      )
        checks.push({
          id: "words",
          level:
            words.total > 0 && words.recorded === words.total && words.timed === words.total
              ? "ok"
              : "warn",
          language,
          ...words,
        });
      if (language !== DEFAULT_LANGUAGE && defaultSpeech.size) {
        const keys = new Set(audio.map((asset) => asset.key));
        const covered = [...defaultSpeech].filter((key) => keys.has(key)).length;
        checks.push({
          id: "coverage",
          level: covered === defaultSpeech.size ? "ok" : "warn",
          language,
          covered,
          total: defaultSpeech.size,
        });
      }
    }
    const visual = defaults.filter((asset) => asset.type !== "audio");
    if (visual.length) {
      const bound = visual.filter((asset) => asset.path).length;
      checks.push({
        id: "media",
        level: bound === visual.length ? "ok" : "warn",
        bound,
        total: visual.length,
      });
    }
  }
  const keys = draft.spec ? conflictingMediaKeys(draft.spec) : [];
  checks.push({ id: "mediaKeys", level: keys.length ? "warn" : "ok", keys });
  const assessment = assessmentCheck(activity, context);
  if (assessment) checks.push(assessment);
  checks.push({ id: "canonical", level: context.canonical ? "ok" : "fail" });
  checks.push({
    id: "checkout",
    level: context.checkoutFound ? "ok" : "fail",
    found: context.checkoutFound,
  });
  return checks;
}
