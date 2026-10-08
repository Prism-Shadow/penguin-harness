/**
 * Which behaviour path an activity is on, and which skills implementing it needs.
 *
 * This looked like it needed a product decision. Measuring the real corpus said 299
 * modules are built on `src/sequence.js` and 4 on the state machine, which reads as a
 * choice between serving new work and serving everything already authored.
 *
 * It is not a choice. Loom decides per activity — `uses_legacy_sequence()` looks at what
 * the module on disk actually contains — and picks a different skill set accordingly. So
 * this is a port, not a decision, and both skill sets were restored in the authoring
 * plugin precisely because the corpus needs them.
 *
 * Ported from `implement_behavior.py`: the two shared skill lists, the behaviour skill
 * that replaces the second entry, and the de-duplication that keeps the order stable.
 */

export type BehaviorPath =
  /** `src/sequence.js`, which almost every already-authored module uses. */
  | "sequence"
  /** The XState-backed WAF state machine, which new work uses. */
  | "machine";

/** What the module directory contains, as far as this decision cares. */
export interface ModuleShape {
  hasSequenceJs: boolean;
  hasIndexTs: boolean;
  /** A scaffold recipe that explicitly overrides `src/sequence.js` forces the old path. */
  overridesSequence?: boolean;
}

/**
 * The path a module is on.
 *
 * Loom's rule exactly: an explicit scaffold override wins; otherwise a module is on the
 * old path when it has `src/sequence.js` and NO `src/index.ts`. The second half matters —
 * a module part-way through migration has both, and treating it as legacy would hand the
 * agent the wrong contract for code that has already moved.
 */
export function behaviorPath(shape: ModuleShape): BehaviorPath {
  if (shape.overridesSequence) return "sequence";
  return shape.hasSequenceJs && !shape.hasIndexTs ? "sequence" : "machine";
}

const SEQUENCE_SHARED = [
  "project-documentation",
  "waf-sequence-implementation-patterns",
  "waf-activity-states",
  "waf-element-ids",
  "waf-asset-usage-patterns",
  "waf-style-guardrails",
  // After the guardrails, which it defers to: a catalogue of how the existing sequence
  // modules lay out, highlight and clean up, which is what editing one of them needs.
  "waf-layout-patterns",
  "waf-audio-patterns",
  "waf-video-patterns",
] as const;

const MACHINE_SHARED = [
  "project-documentation",
  "waf-state-machine",
  "xstate-v5",
  "waf-activity-states",
  "waf-element-ids",
  "waf-asset-usage-patterns",
  "waf-style-guardrails",
  "waf-audio-patterns",
  "waf-video-patterns",
] as const;

const SEQUENCE_BEHAVIOR = "waf-sequence-from-prose";
const MACHINE_BEHAVIOR = "waf-state-machine";
const ASSESSMENT_BEHAVIOR = "waf-assessment-patterns";

/**
 * The skills an implementation run reads, in order.
 *
 * The behaviour skill goes second, after the framework overview and before the pattern
 * skills — Loom's ordering, and it matters because the agent reads these in order and the
 * overview is what makes the rest legible.
 *
 * An activity with assessment gets the assessment skill as its behaviour skill instead of
 * the path's own. That looks odd until you notice `waf-state-machine` is already in the
 * machine path's shared list, so nothing is lost; on the sequence path it means an
 * assessment activity is told how to wire assessment rather than how to write prose
 * sequences, which is the harder of the two.
 *
 * Duplicates are dropped while keeping first position, so a skill named twice does not
 * appear twice.
 */
export function implementationSkills(
  path: BehaviorPath,
  options: { usesAssessment?: boolean; extra?: readonly string[] } = {},
): string[] {
  const shared = path === "sequence" ? SEQUENCE_SHARED : MACHINE_SHARED;
  const behavior = options.usesAssessment
    ? ASSESSMENT_BEHAVIOR
    : path === "sequence"
      ? SEQUENCE_BEHAVIOR
      : MACHINE_BEHAVIOR;
  const ordered = [shared[0], behavior, ...shared.slice(1), ...(options.extra ?? [])];
  return [...new Set(ordered)];
}

/** Whether a specification says the activity is assessed. */
export function usesAssessment(spec: Record<string, unknown> | null): boolean {
  const runtime = spec?.["runtime"];
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return false;
  return (runtime as Record<string, unknown>)["usesAssessment"] === true;
}

/**
 * Whether every skill an implementation run wants is actually available.
 *
 * Reported rather than assumed: a run that silently proceeds without the state-machine
 * contract produces code against an API the agent had to guess at, and the failure shows
 * up as a broken activity rather than a missing skill.
 */
export function missingSkills(wanted: readonly string[], available: readonly string[]): string[] {
  const have = new Set(available);
  return wanted.filter((name) => !have.has(name));
}
